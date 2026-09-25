"""Extrae nuevamente las figuras de la semilla desde el PDF local (requiere PyMuPDF).
Ejecutar desde cualquier directorio: python backend/scripts/recrop-task-images.py
Las coordenadas usan la vista de pagina de 1100 px de ancho, sin escalar el dibujo.
No carga la base de datos ni incluye las paginas de soluciones en los recursos.
"""
import base64
import json
import re
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / 'backend/prisma/seed/bebras-tasks.json'
SOURCE = ROOT / 'tareas-otono-2024/_referencia'
# tarea, nombre del recurso, limites completos; varias regiones evitan texto ajeno.
CROPS = [
    (1, 'pulsera_A.png', [(236, 478, 353, 597)]),
    (1, 'pulsera_B.png', [(395, 480, 518, 598)]),
    (1, 'pulsera_C.png', [(551, 480, 686, 598)]),
    (1, 'pulsera_D.png', [(715, 480, 841, 598)]),
    (3, 'tarjeta_A.png', [(248, 530, 342, 661)]),
    (3, 'tarjeta_B.png', [(409, 530, 503, 661)]),
    (3, 'tarjeta_C.png', [(568, 530, 662, 661)]),
    (3, 'tarjeta_D.png', [(728, 528, 823, 661)]),
    (7, 'brocheta-1.png', [(587.7, 594.9, 638.1, 742.3)]),
    (7, 'brocheta-2.png', [(703.7, 594.0, 754.0, 735.1)]),
    (7, 'brocheta-3.png', [(819.6, 594.9, 870.8, 734.2)]),
    (7, 'brocheta-4.png', [(936.4, 594.0, 986.8, 743.2)]),
    (8, 'repisa_A.png', [(630, 529, 982, 564)]),
    (8, 'repisa_B.png', [(630, 571, 982, 606)]),
    (8, 'repisa_C.png', [(631, 613, 982, 648)]),
    (8, 'repisa_D.png', [(631, 654, 982, 689)]),
    (10, 'emma.png', [(137, 558, 202, 620)]),
    (10, 'alice.png', [(207, 558, 266, 620)]),
    (10, 'lee.png', [(274, 558, 332, 620)]),
    (10, 'bella.png', [(335, 558, 405, 620)]),
    (10, 'james.png', [(409, 558, 467, 620)]),
    (10, 'maya.png', [(478, 558, 532, 620)]),
    (10, 'raul.png', [(544, 558, 602, 620)]),
    (10, 'hannah.png', [(602, 558, 677, 620)]),
    (10, 'diana.png', [(678, 558, 737, 620)]),
    (13, 'crecimiento_arbol.png', [(595, 187, 850, 455)]),
    (27, 'ejemplo_cadena.png', [(746, 450, 965, 604), (647, 512, 799, 646)]),
    (30, 'ejemplo_pulsera.png', [(586, 304, 1039, 498)]),
    (32, 'matriz_amigos.png', [(576, 294, 795, 455), (796, 254, 1008, 455)]),
    (41, 'pared_A.png', [(221, 687, 365, 780)]),
    (41, 'pared_B.png', [(382, 687, 527, 780)]),
    (41, 'pared_C.png', [(546, 687, 689, 780)]),
    (41, 'pared_D.png', [(707, 689, 844, 779)]),
    (41, 'pared-referencia.png', [(620, 501, 865, 659)]),
]


def images(value):
    if isinstance(value, dict):
        if str(value.get('url', '')).startswith('data:image/'):
            yield value
        for child in value.values():
            yield from images(child)
    elif isinstance(value, list):
        for child in value:
            yield from images(child)


def extract(document, page_index, regions):
    scale = document[page_index].rect.width / 1100
    rects = [fitz.Rect(*(v * scale for v in region)) for region in regions]
    bounds = fitz.Rect(rects[0])
    for rect in rects[1:]:
        bounds |= rect
    # Componer regiones del PDF conserva vectores y omite restos del enunciado.
    with fitz.open() as output:
        padding = 2
        page = output.new_page(width=bounds.width + padding * 2, height=bounds.height + padding * 2)
        for rect in rects:
            destination = rect - (bounds.x0 - padding, bounds.y0 - padding, bounds.x0 - padding, bounds.y0 - padding)
            page.show_pdf_page(destination, document, page_index, clip=rect)
        return page.get_pixmap(matrix=fitz.Matrix(4, 4), alpha=False).tobytes('png')


def main():
    tasks = json.loads(SEED.read_text(encoding='utf-8'))
    by_number = {int(task['id'].split('-')[2]): task for task in tasks}
    with fitz.open(next(SOURCE.glob('*.pdf'))) as document:
        pages = {}
        for index, page in enumerate(document):
            match = re.search(r'TAREA\s+(\d+)', page.get_text(), re.I)
            if match:
                pages.setdefault(int(match[1]), index)
        for number, name, regions in CROPS:
            task = by_number[number]
            matches = [img for img in images(task) if img.get('name') == name]
            if not matches and name == 'pared-referencia.png':
                img = {'id': 'img-b41-pared-referencia', 'name': name}
                task['challengeBlocks'].append({
                    'id': 'b41-pared-referencia', 'type': 'image', 'content': '',
                    'image': img, 'widthPercent': 55,
                })
            else:
                if len(matches) != 1:
                    raise ValueError(f'Recurso ausente o duplicado: {number} {name}')
                img = matches[0]
            img['url'] = 'data:image/png;base64,' + base64.b64encode(
                extract(document, pages[number], regions)
            ).decode('ascii')
        # El escenario conserva su proporcion y las coordenadas de los destinos.
        # La fila completa se centra en el lienzo; se excluye la instruccion impresa.
        page = document[pages[10]]
        scale = page.rect.width / 1100
        with fitz.open() as output:
            canvas = output.new_page(width=750, height=90)
            canvas.show_pdf_page(fitz.Rect(0, 25, 750, 69), document, pages[10],
                clip=fitz.Rect(*(v * scale for v in (123, 620, 751, 660))), keep_proportion=False)
            data = canvas.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).tobytes('png')
        by_number[10]['dragDropBackground']['url'] = 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')
    SEED.write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(CROPS) + 1} imagenes actualizadas en {len(set(n for n, _, _ in CROPS))} tareas.')


if __name__ == '__main__':
    main()
