#!/bin/bash
# Двойной клик в Finder: запускает сервер и открывает сайт.
cd "$(dirname "$0")"
(sleep 1 && open "http://localhost:4777") &
node server.mjs
