"""Fetch only this project's runtime through the explicit user proxy."""
from pathlib import Path
import hashlib, json, os, subprocess, sys, zipfile
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
opener=build_opener(ProxyHandler({'http':'http://127.0.0.1:7890','https':'http://127.0.0.1:7890'}))

def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with opener.open(url,timeout=180) as response: data=response.read()
    target.write_bytes(data)
    print(target.name, len(data), hashlib.sha256(data).hexdigest(), flush=True)
    return target

def main():
    cache = ROOT / '.scratch' / 'downloads'
    runtime = ROOT / 'runtime'
    if not (runtime / 'python.exe').exists():
        archive = fetch('https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip', cache / 'python-3.12.10-embed-amd64.zip')
        if hashlib.sha256(archive.read_bytes()).hexdigest()!='4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3':raise ValueError('Python checksum mismatch')
        runtime.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as file: file.extractall(runtime)
    (runtime / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages-cp312\nLib/site-packages-cp312/win32\nLib/site-packages-cp312/win32/lib\nLib/site-packages-cp312/Pythonwin\nLib/site-packages-cp312/pywin32_system32\n..\n', encoding='utf-8')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--proxy', 'http://127.0.0.1:7890', '--index-url', 'https://pypi.org/simple', '--only-binary', ':all:', '--ignore-installed', '--python-version', '3.12', '--implementation', 'cp', '--abi', 'cp312', '--platform', 'win_amd64', '--target', str(runtime / 'Lib/site-packages-cp312'), '-r', str(ROOT / 'backend/requirements.lock.txt')], check=True)
    dest = ROOT / 'node_modules/electron/dist'
    if not (dest / 'electron.exe').exists():
        base = 'https://github.com/electron/electron/releases/download/v45.1.0/'
        archive = fetch(base + 'electron-v45.1.0-win32-x64.zip', cache / 'electron-v45.1.0-win32-x64.zip')
        sums = fetch(base + 'SHASUMS256.txt', cache / 'electron-SHASUMS256.txt').read_text()
        expected = next(line.split()[0] for line in sums.splitlines() if line.endswith('electron-v45.1.0-win32-x64.zip'))
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected: raise ValueError('Electron checksum mismatch')
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as file: file.extractall(dest)
        (dest.parent / 'path.txt').write_text('electron.exe', encoding='utf-8')
    print('Independent runtime ready', flush=True)

if __name__ == '__main__': main()
