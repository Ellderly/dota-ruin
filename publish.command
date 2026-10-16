#!/bin/bash
# Двойной клик в Finder: создаёт репозиторий на GitHub, заливает проект и включает GitHub Pages.
# Один раз попросит войти в GitHub (откроется браузер). Имя репозитория можно передать аргументом.
cd "$(dirname "$0")" || exit 1
set -e
NAME="${1:-dota-ruin}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Ставлю GitHub CLI (gh) через Homebrew…"
  brew install gh
fi
if ! gh auth status >/dev/null 2>&1; then
  gh auth login --web --git-protocol https
fi

OWNER="$(gh api user -q .login)"
if gh repo view "$OWNER/$NAME" >/dev/null 2>&1; then
  echo "Репозиторий $OWNER/$NAME уже есть — просто обновляю."
else
  gh repo create "$NAME" --public --source=. --remote=origin --description "Кто заруинил? — разбор матчей Dota 2"
  # Pages включаем до первого пуша, чтобы автодеплой сразу сработал
  gh api -X POST "repos/$OWNER/$NAME/pages" -f build_type=workflow >/dev/null 2>&1 || true
fi
git push -u origin main

echo
echo "Готово. Сайт появится через 1–2 минуты:  https://$OWNER.github.io/$NAME/"
echo "Ход публикации:  https://github.com/$OWNER/$NAME/actions"
