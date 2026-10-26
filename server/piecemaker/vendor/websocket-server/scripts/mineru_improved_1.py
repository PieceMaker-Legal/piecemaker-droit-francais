#!/usr/bin/env python3
import argparse
import ctypes
import importlib.util
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

GIB = 1024 ** 3
WATCH_INTERVAL_S = 0.5
RAM_SHARE = 0.35
BOUNDED_ENV = {
    'MINERU_MODEL_SMALL_BACKEND': 'onnx',
    'MINERU_PROCESSING_WINDOW_SIZE': '1',
    'MINERU_PDF_RENDER_THREADS': '1',
    'MINERU_INTRA_OP_NUM_THREADS': '2',
    'MINERU_INTER_OP_NUM_THREADS': '1',
    'MINERU_MODEL_VLM_MAX_CONCURRENCY': '1',
    'MINERU_VIRTUAL_VRAM_SIZE': '1',
    'MINERU_TABLE_DEVICE': 'cpu',
    'OMP_NUM_THREADS': '2',
    'HF_HUB_OFFLINE': '1',
}
ENGINE_LIMITS = {'n_parallel': 1, 'n_ctx_seq': 8192, 'n_threads': 4, 'n_gpu_layers': 0}


def mineru_available():
    return importlib.util.find_spec('mineru') is not None and importlib.util.find_spec('mineru_llama_cpp') is not None


def ram_limit_bytes(total_bytes):
    configured = int(os.environ.get('PIECEMAKER_MINERU_RAM_BYTES') or 0)
    return configured or int(total_bytes * RAM_SHARE)


def available_floor_bytes(total_bytes):
    configured = int(os.environ.get('PIECEMAKER_MINERU_FREE_FLOOR_BYTES') or 0)
    return configured or int(total_bytes * 0.05)


def split_pages(source, workdir):
    if source.suffix.lower() != '.pdf':
        return [source]
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(source)
    pages = []
    try:
        for index in range(len(document)):
            single = pdfium.PdfDocument.new()
            single.import_pages(document, [index])
            target = workdir / f'page-{index + 1:04d}.pdf'
            single.save(target)
            single.close()
            pages.append(target)
    finally:
        document.close()
    return pages


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
        return f'MinerU dépasse son plafond de {gigabytes(limit)} Go de RAM'
    if psutil.virtual_memory().available < floor:
        return f'moins de {gigabytes(floor)} Go de mémoire libre sur le poste'
    return None


def run_page(page, target):
    import psutil
    total = psutil.virtual_memory().total
    limit, floor = ram_limit_bytes(total), available_floor_bytes(total)
    child = subprocess.Popen(
        [sys.executable, __file__, '--page', str(page), str(target)],
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
        raise RuntimeError(f'MinerU a échoué (code {child.returncode}).')


def exit_when_orphaned(supervisor_pid):
    while os.getppid() == supervisor_pid:
        time.sleep(WATCH_INTERVAL_S)
    os._exit(1)


def parse_page(page, target):
    threading.Thread(target=exit_when_orphaned, args=(os.getppid(),), daemon=True).start()
    import mineru_llama_cpp
    engine_init = mineru_llama_cpp.Engine.__init__

    def bounded_engine_init(self, *args, **kwargs):
        engine_init(self, *args, **{**kwargs, **ENGINE_LIMITS})

    mineru_llama_cpp.Engine.__init__ = bounded_engine_init
    from mineru.parser import parse
    Path(target).write_text(parse(page, tier='standard').markdown(), encoding='utf-8')


def convert(source, output_dir):
    with tempfile.TemporaryDirectory(prefix='piecemaker-mineru-') as scratch:
        workdir = Path(scratch)
        pages = split_pages(source, workdir)
        parts = []
        for number, page in enumerate(pages, start=1):
            print(f'MinerU : page {number}/{len(pages)}', file=sys.stderr, flush=True)
            target = workdir / f'page-{number:04d}.md'
            run_page(page, target)
            parts.append(target.read_text(encoding='utf-8').strip())
    output = Path(output_dir) / f'{source.stem}.md'
    output.write_text('\n\n'.join(part for part in parts if part) + '\n', encoding='utf-8')
    return output


def main():
    parser = argparse.ArgumentParser(description='MinerU, une page à la fois et sous plafond de RAM')
    parser.add_argument('file')
    parser.add_argument('target', nargs='?')
    parser.add_argument('-o', '--output', default='./mineru_output')
    parser.add_argument('--page', action='store_true')
    args = parser.parse_args()
    if args.page:
        parse_page(args.file, args.target)
        return 0
    source = Path(args.file)
    if not source.exists():
        print(f'Fichier introuvable : {source}', file=sys.stderr)
        return 1
    Path(args.output).mkdir(parents=True, exist_ok=True)
    try:
        output = convert(source, args.output)
    except (MemoryError, RuntimeError) as error:
        print(f'\n{error}', file=sys.stderr)
        return 1
    print(f'Markdown écrit : {output}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
