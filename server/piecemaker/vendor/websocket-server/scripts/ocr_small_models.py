import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path


CHECKPOINTS = json.loads(Path(__file__).with_name('ocr-small-checkpoints.json').read_text(encoding='utf-8'))['models']


def snapshot_directory(checkpoint):
    home = Path(os.environ.get('HF_HOME') or Path.home() / '.cache' / 'huggingface')
    hub = Path(os.environ.get('HUGGINGFACE_HUB_CACHE') or os.environ.get('HF_HUB_CACHE') or home / 'hub')
    return hub / f"models--{checkpoint['modelId'].replace('/', '--')}" / 'snapshots' / checkpoint['revision']


def models_cached():
    try:
        return all(
            json.loads((snapshot_directory(model) / '.piecemaker-ocr-small.json').read_text(encoding='utf-8')) == {'modelId': model['modelId'], 'revision': model['revision']}
            and all((snapshot_directory(model) / file['path']).stat().st_size == file['size'] for file in model['files'])
            for model in CHECKPOINTS
        )
    except (OSError, ValueError):
        return False


def ocr_available():
    return all(importlib.util.find_spec(name) is not None for name in ('paddleocr', 'onnxruntime', 'pypdfium2', 'psutil')) and models_cached()


def download_models():
    from huggingface_hub import snapshot_download
    for model in CHECKPOINTS:
        print(json.dumps({'message': f"Téléchargement de {model['modelId']}…", 'phase': 'start'}), flush=True)
        directory = Path(snapshot_download(model['modelId'], revision=model['revision'], allow_patterns=[file['path'] for file in model['files']]))
        for file in model['files']:
            digest = hashlib.sha256((directory / file['path']).read_bytes()).hexdigest()
            if digest != file['sha256']:
                raise RuntimeError(f"Modèle OCR invalide : {model['kind']}/{file['path']}")
        (directory / '.piecemaker-ocr-small.json').write_text(json.dumps({'modelId': model['modelId'], 'revision': model['revision']}), encoding='utf-8')
    if not models_cached():
        raise RuntimeError('Les modèles Small téléchargés sont incomplets.')
    print(json.dumps({'message': 'PP-OCRv6 Small est prêt.', 'phase': 'complete'}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if args.download:
        download_models()
    else:
        ready = ocr_available()
        print(json.dumps({'installed': ready}))
        raise SystemExit(0 if ready else 1)
