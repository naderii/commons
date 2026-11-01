#!/usr/bin/env bash
# بعد از `mkdocs build`: فایل‌های source map را حذف کن (حدود ۱MB، برای تولید لازم نیستند)
# و ارجاع sourceMappingURL را هم بردار تا devtools خطای ۴۰۴ ندهد.
set -euo pipefail
SITE="${1:-site}"
[ -d "$SITE" ] || { echo "پوشهٔ $SITE وجود ندارد" >&2; exit 1; }
find "$SITE" -type f -name '*.map' -delete
find "$SITE" -type f \( -name '*.js' -o -name '*.css' \) -exec sed -i -E '/^\/\/# sourceMappingURL=|^\/\*# sourceMappingURL=/d' {} +
echo "source map ها حذف شدند: $(find "$SITE" -name '*.map' | wc -l) باقی مانده"
