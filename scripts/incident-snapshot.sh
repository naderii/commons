#!/usr/bin/env bash
# incident-snapshot.sh — ثبت وضعیت سیستم در شروع رخداد (فقط‌خواندنی، بدون تغییر)
#
# استفاده:   sudo ./incident-snapshot.sh [--full] [OUTPUT_DIR]
#   --full   لیست پردازش‌ها را با آرگومان کامل هم ذخیره کن (ممکن است رمز/توکن در خط فرمان باشد!)
#
# خروجی: OUTPUT_DIR/incident-HOST-YYYYmmdd-HHMMSS/*.txt  +  فایل .tar.gz (مجوز 600)
# پیش‌فرض OUTPUT_DIR=/var/tmp.   هیچ فایلی را تغییر نمی‌دهد، چیزی را ریستارت نمی‌کند.
# هر مرحله جدا اجرا و در صورت خطا/نبود ابزار، رد می‌شود (بدون توقف).

set -u -o pipefail
umask 077

FULL=0
if [ "${1:-}" = "--full" ]; then FULL=1; shift; fi
OUT_BASE="${1:-/var/tmp}"
HOST="$(hostname -s 2>/dev/null || echo unknown)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="$OUT_BASE/incident-$HOST-$STAMP"
TIMEOUT_BIN="$(command -v timeout || true)"

mkdir -p "$DIR" || { echo "نمی‌توان $DIR را ساخت" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || echo "هشدار: بدون root، بعضی خروجی‌ها (ss -p، lsof، لاگ‌ها) ناقص خواهند بود." >&2

# run NAME CMD...  → خروجی در $DIR/NAME.txt ؛ حداکثر ۳۰ ثانیه
run() {
  local name="$1"; shift
  command -v "$1" >/dev/null 2>&1 || { echo "(ابزار $1 نصب نیست)" > "$DIR/$name.txt"; return 0; }
  {
    echo "# $(date -Is)  \$ $*"
    if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" 30 "$@" 2>&1; else "$@" 2>&1; fi
    echo "# exit=$?"
  } > "$DIR/$name.txt"
}
# sh NAME 'pipeline' → برای فرمان‌های دارای pipe
sh_run() {
  local name="$1"; shift
  {
    echo "# $(date -Is)  \$ $*"
    if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" 30 bash -c "$*" 2>&1; else bash -c "$*" 2>&1; fi
  } > "$DIR/$name.txt"
}

echo "جمع‌آوری در $DIR …"

# هویت و زمان
run  00-identity      hostnamectl
sh_run 01-os          'cat /etc/os-release; uname -a; date -Is; timedatectl 2>/dev/null; id; whoami'
run  02-uptime        uptime
run  03-who           w
sh_run 04-last        'last -a -n 30; echo; lastb -n 20 2>/dev/null'

# منابع
run  10-free          free -h
run  11-df            df -hT
run  12-df-inodes     df -ih
sh_run 13-pressure    'for f in cpu memory io; do echo "== $f"; cat /proc/pressure/$f 2>/dev/null; done'
run  14-vmstat        vmstat 1 5
run  15-iostat        iostat -xz 1 3
sh_run 16-top-cpu     'ps -eo pid,ppid,user,stat,%cpu,%mem,rss,etime,comm --sort=-%cpu | head -25'
sh_run 17-top-mem     'ps -eo pid,ppid,user,stat,%cpu,%mem,rss,etime,comm --sort=-rss | head -25'
sh_run 18-d-state     'ps -eo pid,stat,wchan:30,comm | awk "\$2 ~ /^D/"'
run  19-lsblk         lsblk -f
run  19b-mounts-ro    findmnt -O ro
sh_run 19c-deleted-open 'lsof +L1 2>/dev/null | head -40'

# سرویس‌ها
sh_run 20-failed      'systemctl --failed --no-pager; systemctl is-system-running'
sh_run 21-running     'systemctl list-units --type=service --state=running --no-pager'
run  22-timers        systemctl list-timers --all --no-pager

# شبکه
run  30-ip-addr       ip -br addr
run  31-ip-link-stats ip -s link
run  32-ip-route      ip route
sh_run 33-dns         'resolvectl status 2>/dev/null || cat /etc/resolv.conf'
run  34-ss-listen     ss -lntup
run  35-ss-summary    ss -s
sh_run 36-firewall    'nft list ruleset 2>/dev/null | head -200; echo ---; iptables -S 2>/dev/null | head -100; echo ---; ufw status verbose 2>/dev/null; firewall-cmd --list-all 2>/dev/null'

# لاگ‌ها
sh_run 40-journal-err 'journalctl -p err -b --no-pager -n 300'
sh_run 41-journal-now 'journalctl --since "-30 min" --no-pager -n 500'
sh_run 42-dmesg       'dmesg -T 2>/dev/null | tail -200'
sh_run 43-oom         'dmesg -T 2>/dev/null | grep -iE "out of memory|killed process" | tail -20; journalctl -k -b --no-pager 2>/dev/null | grep -iE "out of memory|killed process" | tail -20'
sh_run 44-auth        'journalctl _COMM=sshd --since "-2 hours" --no-pager -n 200 2>/dev/null || tail -200 /var/log/auth.log /var/log/secure 2>/dev/null'

# تغییرات اخیر
sh_run 50-pkg-changes 'grep -E " (install|upgrade|remove) " /var/log/dpkg.log 2>/dev/null | tail -30; dnf history 2>/dev/null | head -15'
sh_run 51-etc-recent  'find /etc -xdev -type f -mtime -2 -printf "%TY-%Tm-%Td %TH:%TM  %u:%g  %m  %p\n" 2>/dev/null | sort -r | head -50'

# کانتینر (بدون inspect و env تا رمز نشت نکند)
if command -v docker >/dev/null 2>&1; then
  run 60-docker-ps    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  run 61-docker-df    docker system df
  run 62-docker-stats docker stats --no-stream
fi

# پردازش با آرگومان کامل (فقط با --full)
if [ "$FULL" -eq 1 ]; then
  sh_run 70-ps-full 'ps auxwwf'
  echo "هشدار: 70-ps-full.txt ممکن است شامل رمز/توکن در آرگومان‌ها باشد؛ قبل از اشتراک بررسی کنید." >&2
fi

ARCHIVE="$DIR.tar.gz"
tar -czf "$ARCHIVE" -C "$OUT_BASE" "$(basename "$DIR")" 2>/dev/null && chmod 600 "$ARCHIVE"
chmod -R go-rwx "$DIR" 2>/dev/null

echo
echo "تمام شد."
echo "  پوشه : $DIR"
echo "  آرشیو: $ARCHIVE"
echo "نکته: خروجی ممکن است اطلاعات حساس (نام کاربران، IP ها، لاگ‌ها) داشته باشد؛ فقط با افراد مجاز به اشتراک بگذارید."
