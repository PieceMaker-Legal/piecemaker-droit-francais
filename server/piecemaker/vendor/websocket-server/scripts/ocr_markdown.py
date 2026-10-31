import html
import math
import re
import statistics


NUMBER = re.compile(r'[\d\s.,()%+−—–\-/⁰¹²³⁴⁵⁶⁷⁸⁹]+')


def page_markdown(data):
    texts, boxes = data['lines'], data['boxes']
    if len(texts) != len(boxes):
        raise ValueError('Le JSON OCR doit fournir une boîte par texte.')
    items = []
    for text, box in zip(texts, boxes):
        if len(box) != 4 or any(len(point) != 2 or not all(math.isfinite(value) for value in point) for point in box):
            raise ValueError('Coordonnées OCR invalides.')
        xs, ys = zip(*box)
        items.append({'text': text, 'left': min(xs), 'right': max(xs), 'y': statistics.mean(ys), 'height': max(ys) - min(ys)})
    if not items:
        return ''
    height = max(1, statistics.median(item['height'] for item in items))
    rows = []
    for item in sorted(items, key=lambda item: (item['y'], item['left'])):
        if not rows or item['y'] - statistics.mean(cell['y'] for cell in rows[-1]) > height * 0.55:
            rows.append([])
        rows[-1].append(item)
    rows = [sorted(row, key=lambda item: item['left']) for row in rows]
    numeric = [item for item in items if NUMBER.fullmatch(item['text'])]
    clusters = []
    for item in sorted(numeric, key=lambda item: item['right']):
        if not clusters or item['right'] - statistics.median(cell['right'] for cell in clusters[-1]) > height * 1.5:
            clusters.append([])
        clusters[-1].append(item)
    columns = [group for group in clusters if len(group) >= 3]
    anchors = [statistics.median(item['right'] for item in group) for group in columns]
    centers = [statistics.median((item['left'] + item['right']) / 2 for item in group) for group in columns]

    def numeric_columns(row):
        return {index for item in row if NUMBER.fullmatch(item['text']) for index, x in enumerate(anchors) if abs(item['right'] - x) <= height * 1.5}

    cores = [index for index, row in enumerate(rows) if len(numeric_columns(row)) >= 2]
    runs = []
    for index in cores:
        if not runs or rows[index][0]['y'] - rows[runs[-1][-1]][0]['y'] > height * 4:
            runs.append([])
        runs[-1].append(index)
    tables = {}
    for run in runs:
        if len(run) < 3:
            continue
        active = [index for index in range(len(anchors)) if sum(index in numeric_columns(rows[row]) for row in run) >= 3]
        if len(active) < 2:
            continue
        first, last = run[0], run[-1]
        if first and len(rows[first - 1]) >= len(active) and rows[first][0]['y'] - rows[first - 1][0]['y'] <= height * 2.5:
            first -= 1
        tables[first] = (last, active)
    output = []
    index = 0
    while index < len(rows):
        if index not in tables:
            output.append(' '.join(item['text'] for item in rows[index]))
            index += 1
            continue
        last, active = tables[index]
        grid = []
        for row in rows[index:last + 1]:
            cells = [[] for _ in range(len(active) + 1)]
            for item in row:
                if item['right'] < centers[active[0]] - height:
                    column = 0
                else:
                    column = 1 + min(range(len(active)), key=lambda i: abs(anchors[active[i]] - item['right']))
                cells[column].append(item['text'])
            grid.append(cells)
        if not any(row[0] for row in grid):
            grid = [row[1:] for row in grid]
        table = ['| ' + ' | '.join([''] * len(grid[0])) + ' |', '| ' + ' | '.join(['---'] * len(grid[0])) + ' |']
        for row in grid:
            cells = ['<br>'.join(html.escape(text, quote=False).replace('|', '\\|').replace('\n', ' ') for text in cell) for cell in row]
            table.append('| ' + ' | '.join(cells) + ' |')
        output.extend(['', '\n'.join(table), ''])
        index = last + 1
    return '\n'.join(output).strip() + '\n'
