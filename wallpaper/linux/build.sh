#!/bin/sh
# Packages the Linux app: the Python app, the pond page and the icon, as build/koipond-linux.tar.gz.
set -e
cd "$(dirname "$0")/.."
rm -rf build/linux && mkdir -p build/linux/web
cp linux/koipond.py build/linux/
cp build/web/index.html build/linux/web/
cp ../demo/public/icon.png build/linux/koipond.png
tar -czf build/koipond-linux.tar.gz -C build/linux .
echo "built build/koipond-linux.tar.gz"
