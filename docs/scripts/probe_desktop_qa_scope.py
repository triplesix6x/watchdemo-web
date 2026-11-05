"""Metadata-only census of the desktop dev root; never opens demos or databases.

Premise under test: watching the whole desktop repository is a cheap way to
serve a small isolated Svelte fixture. Compare application source to Rust build
output before choosing the Vite watch scope. Rerunnable with Python stdlib.
"""
import os
from pathlib import Path

root = Path('D:/demo-manager')
for relative in ('src', 'src-tauri/target', 'src-tauri/tests/fixtures'):
    count = 0
    directories = 0
    for directory, children, files in os.walk(root / relative):
        count += len(files)
        directories += 1
    print(f'{relative}: {count} files, {directories} directories (metadata only)')
