import argparse
import ctypes
import gc
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from ocr_small_models import CHECKPOINTS, ocr_available, snapshot_directory
from ocr_markdown import page_markdown

GIB = 1024 ** 3
WATCH_INTERVAL_S = 0.5
RAM_SHARE = 0.35
BOUNDED_ENV = {
    'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2',
    'VECLIB_MAXIMUM_THREADS': '2', 'TOKENIZERS_PARALLELISM': 'false',
    'HF_HUB_OFFLINE': '1', 'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK': 'True',
}


def ram_limit_bytes(total_bytes):
    return int(os.environ.get('PIECEMAKER_OCR_RAM_BYTES') or os.environ.get('PIECEMAKER_MINERU_RAM_BYTES') or total_bytes * RAM_SHARE)


def available_floor_bytes(total_bytes):
    return int(os.environ.get('PIECEMAKER_OCR_FREE_FLOOR_BYTES') or os.environ.get('PIECEMAKER_MINERU_FREE_FLOOR_BYTES') or max(512 * 1024 ** 2, total_bytes * 0.10))


class DarwinRusage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64)
        for name in ('user_time', 'system_time', 'idle_wakeups', 'interrupt_wakeups', 'pageins', 'wired_size', 'resident_size', 'phys_footprint', 'proc_start_abstime', 'proc_exit_abstime')
    ]


def process_memory(member):
    if sys.platform == 'darwin':
        usage = DarwinRusage()
        if ctypes.CDLL('/usr/lib/libproc.dylib').proc_pid_rusage(member.pid, 0, ctypes.byref(usage)) == 0:
            return usage.phys_footprint
    return member.memory_info().rss


def tree_memory(process):
    import psutil
    total = 0
    for member in [process, *process.children(recursive=True)]:
        try:
            total += process_memory(member)
        except psutil.Error:
            pass
    return total


def kill_tree(process):
    import psutil
    for member in [*process.children(recursive=True), process]:
        try:
            member.kill()
        except psutil.Error:
            pass


def gigabytes(size):
    return f'{size / GIB:.1f}'.replace('.', ',')


def overload_reason(process, limit, floor):
    import psutil
    if tree_memory(process) > limit:
        return f'Small dépasse son plafond de {gigabytes(limit)} Go de RAM'
    if psutil.virtual_memory().available < floor:
        return f'moins de {gigabytes(floor)} Go de mémoire libre sur le poste'
    return None


def run_page(page, target, page_index):
    import psutil
    total = psutil.virtual_memory().total
    limit, floor = ram_limit_bytes(total), available_floor_bytes(total)
    child = subprocess.Popen(
        [sys.executable, __file__, '--page', str(page), str(target), '--page-index', str(page_index)],
        env={**os.environ, **BOUNDED_ENV},
    )
    watched = psutil.Process(child.pid)
    while child.poll() is None:
        reason = overload_reason(watched, limit, floor)
        if reason:
            kill_tree(watched)
            child.wait()
            raise MemoryError(f'Conversion arrêtée : {reason}.')
        time.sleep(WATCH_INTERVAL_S)
    if child.returncode != 0:
        raise RuntimeError(f'Small a échoué (code {child.returncode}).')


def exit_when_orphaned(supervisor_pid):
    while os.getppid() == supervisor_pid:
        time.sleep(WATCH_INTERVAL_S)
    os._exit(1)

def parse_page(source, target, page_index):
    threading.Thread(target=exit_when_orphaned, args=(os.getppid(),), daemon=True).start()
    from paddleocr import PaddleOCR
    import numpy as np
    import cv2
    from PIL import Image, ImageOps
    cv2.setNumThreads(2)
    paths = {model['kind']: str(snapshot_directory(model)) for model in CHECKPOINTS}
    engine = PaddleOCR(
        text_detection_model_name='PP-OCRv6_small_det', text_recognition_model_name='PP-OCRv6_small_rec',
        text_detection_model_dir=paths['det'], text_recognition_model_dir=paths['rec'],
        engine='onnxruntime', device='cpu',
        engine_config={
            'providers': ['CPUExecutionProvider'], 'intra_op_num_threads': 2, 'inter_op_num_threads': 1,
            'enable_cpu_mem_arena': False, 'enable_mem_pattern': False,
        },
        text_recognition_batch_size=1,
        text_det_limit_side_len=3200, text_det_limit_type='max',
        text_det_thresh=0.3, text_det_box_thresh=0.6, text_det_unclip_ratio=1.5,
        text_rec_score_thresh=0.0,
        use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
    )
    engine.paddlex_pipeline.text_det_model.post_op.use_dilation = True
    if Path(source).suffix.lower() == '.pdf':
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(source) as document:
            page = document[page_index]
            bitmap = page.render(scale=300 / 72)
            image = bitmap.to_pil().convert('RGB')
            bitmap.close()
            page.close()
    else:
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
    pixels = np.asarray(image)[:, :, ::-1].copy()
    image.close()
    result = engine.predict(pixels)[0]
    data = {
        'page': page_index + 1, 'dpi': 300 if Path(source).suffix.lower() == '.pdf' else None,
        'lines': list(result['rec_texts']), 'scores': [float(value) for value in result['rec_scores']],
        'boxes': [box.tolist() for box in result['rec_polys']],
    }
    Path(target).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    del result, engine, pixels
    gc.collect()


def convert(source, output_dir):
    if not ocr_available():
        raise RuntimeError('PP-OCRv6 Small est absent ou incomplet. Installez le modèle OCR dans les réglages.')
    count = 1
    if source.suffix.lower() == '.pdf':
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(source) as document:
            count = len(document)
    if not count:
        raise ValueError('Le document ne contient aucune page.')
    output = Path(output_dir) / f'{source.stem}.md'
    with tempfile.TemporaryDirectory(prefix='piecemaker-small-') as scratch:
        parts = []
        for index in range(count):
            print(f'Small : page {index + 1}/{count}', file=sys.stderr, flush=True)
            target = Path(scratch) / f'page-{index + 1:04d}.json'
            run_page(source, target, index)
            parts.append(page_markdown(json.loads(target.read_text(encoding='utf-8'))).strip())
        output.write_text('\n\n'.join(parts) + '\n', encoding='utf-8')
        output.chmod(0o600)
    return output


def main():
    parser = argparse.ArgumentParser(description='PP-OCRv6 Small, sur CPU et une page à la fois')
    parser.add_argument('file', type=Path)
    parser.add_argument('target', nargs='?')
    parser.add_argument('-o', '--output', default='./ocr_output')
    parser.add_argument('--page', action='store_true')
    parser.add_argument('--page-index', type=int, default=0)
    args = parser.parse_args()
    if args.page:
        parse_page(args.file, args.target, args.page_index)
        return 0
    Path(args.output).mkdir(parents=True, exist_ok=True)
    try:
        convert(args.file, args.output)
    except Exception as error:
        print(f'Conversion arrêtée : {error}', file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
