#!/usr/bin/env python3
import json
import os
import sys
import tkinter as tk

STATUS_PATH = sys.argv[1] if len(sys.argv) > 1 else ''
PARENT_PID = int(sys.argv[2]) if len(sys.argv) > 2 else 0

TEXT = '#374151'
MUTED = '#6b7280'
ACCENT = '#0088ff'
TRACK = '#e5e7eb'
BG = '#ffffff'
WIDTH = 480
HEIGHT = 176
POLL_MS = 400
CLOSE_MS = 2500

root = tk.Tk()
root.title('PieceMaker')
root.resizable(False, False)
root.configure(bg=BG)
root.attributes('-topmost', True)
root.after(1000, lambda: root.attributes('-topmost', False))
root.update_idletasks()
x = max((root.winfo_screenwidth() - WIDTH) // 2, 40)
y = max((root.winfo_screenheight() - HEIGHT) // 2, 80)
root.geometry(f'{WIDTH}x{HEIGHT}+{x}+{y}')

pad = tk.Frame(root, bg=BG, padx=22, pady=18)
pad.pack(fill='both', expand=True)

title = tk.Label(pad, text='Installation de PieceMaker', font=('Helvetica', 15, 'bold'), fg=TEXT, bg=BG, anchor='w')
title.pack(fill='x')
version = tk.Label(pad, text='', font=('Helvetica', 11), fg=MUTED, bg=BG, anchor='w')
version.pack(fill='x', pady=(0, 8))
step = tk.Label(pad, text='Démarrage…', font=('Helvetica', 13), fg=TEXT, bg=BG, anchor='w')
step.pack(fill='x')
detail = tk.Label(pad, text='', font=('Helvetica', 11), fg=MUTED, bg=BG, anchor='w')
detail.pack(fill='x', pady=(2, 0))

bar_host = tk.Frame(pad, bg=TRACK, height=8)
bar_host.pack(fill='x', pady=(14, 10))
bar_host.pack_propagate(False)
fill = tk.Frame(bar_host, bg=ACCENT)
fill.place(x=0, y=0, relheight=1, width=4)

footer = tk.Label(pad, text='Cela peut prendre plusieurs minutes.', font=('Helvetica', 11), fg=MUTED, bg=BG, anchor='w')
footer.pack(fill='x')

done_at = 0


def process_alive(pid):
    if not pid:
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def set_ratio(ratio):
    bar_host.update_idletasks()
    width = int(bar_host.winfo_width() * max(0.0, min(1.0, ratio)))
    fill.place(x=0, y=0, relheight=1, width=max(width, 0))


def fail(message):
    global done_at
    done_at = -1
    step.config(text='Installation interrompue')
    detail.config(text=message)
    footer.config(text='Vous pouvez fermer cette fenêtre.')
    set_ratio(0)


def read_status():
    try:
        with open(STATUS_PATH, encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def refresh():
    global done_at
    if done_at > 0:
        if (root.tk.call('clock', 'milliseconds') - done_at) > CLOSE_MS:
            root.destroy()
            return
        root.after(POLL_MS, refresh)
        return

    status = read_status()
    parent = int((status or {}).get('pid') or PARENT_PID or 0)
    if not status:
        if not process_alive(parent):
            fail("L'installation s'est interrompue.")
        root.after(POLL_MS, refresh)
        return

    if status.get('version'):
        version.config(text=str(status['version']))
    if status.get('step'):
        step.config(text=status['step'])
    if 'detail' in status:
        detail.config(text=status.get('detail') or '')
    total = max(int(status.get('total') or 1), 1)
    current = max(int(status.get('current') or 0), 0)
    set_ratio(current / total)
    state = status.get('state')
    if state == 'done':
        set_ratio(1)
        footer.config(text=status.get('step') or 'Installation terminée.')
        done_at = int(root.tk.call('clock', 'milliseconds'))
    elif state == 'failed':
        fail(status.get('error') or "L'installation a échoué.")
    elif not process_alive(parent):
        fail("L'installation s'est interrompue.")
    root.after(POLL_MS, refresh)


root.after(150, refresh)
root.mainloop()
