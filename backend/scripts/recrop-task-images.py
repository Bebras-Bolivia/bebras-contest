"""Extrae nuevamente las figuras de la semilla desde el PDF local (requiere PyMuPDF).
Ejecutar desde cualquier directorio: python backend/scripts/recrop-task-images.py
Las coordenadas usan la vista de pagina de 1100 px de ancho, sin escalar el dibujo.
No carga la base de datos. De la solucion solo se toma la figura, nunca su texto.
"""
import base64
import io
import json
import re
from pathlib import Path
import fitz
from PIL import Image, ImageDraw

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
    (24, 'fila_biblioteca.png', [(637, 482, 942, 624)]),
    (27, 'ejemplo_cadena.png', [(746, 450, 965, 604), (647, 512, 799, 646)]),
    (30, 'ejemplo_pulsera.png', [(586, 304, 1039, 498)]),
    (32, 'matriz_amigos.png', [(576, 294, 795, 455), (796, 254, 1008, 455)]),
    (41, 'pared_A.png', [(221, 687, 365, 780)]),
    (41, 'pared_B.png', [(382, 687, 527, 780)]),
    (41, 'pared_C.png', [(546, 687, 689, 780)]),
    (41, 'pared_D.png', [(707, 689, 844, 779)]),
    (41, 'pared-referencia.png', [(620, 501, 865, 659)]),
]

# Figuras que se renderizan directo de la pagina, con margen y sin tocar nada
# vecino: tarea, recurso, pagina dentro de la tarea (0 = la primera), regiones.
# Con varias regiones, lo que queda entre ellas va en blanco (texto intercalado).
FIGURES = [
    (1, 'bebras-2024-01-caja-de-pulseras-solution.png', 0, [(569, 680, 968, 1025)]),
    (5, 'bebras-2024-05-pintando-solution.png', 0, [(586, 800, 981, 953)]),
    (7, 'preferencias-castores.png', 0, [(150, 239, 994, 447)]),
    (7, 'bebras-2024-07-fiesta-solution.png', 0, [(137, 816, 560, 975)]),
    (9, 'bebras-2024-09-tubo-canicas-solution.png', 0, [(148, 756, 981, 1037)]),
    (10, 'bebras-2024-10-video-llamada-solution.png', 0, [(377, 757, 941, 860)]),
    (11, 'bebras-2024-11-dibujando-barquitos-solution.png', 0, [(239, 654, 441, 801)]),
    (13, 'bebras-2024-13-arbol-flor-milagrosa-solution.png', 0, [(584, 733, 1011, 1046)]),
    (15, 'estacionamiento_dias.png', 0, [(547, 190, 1020, 391)]),
    (17, 'bebras-2024-17-faros-solution.png', 0, [(631, 607, 932, 890)]),
    (20, 'opciones-niveles.png', 0, [(123, 674, 994, 796)]),
    (21, 'paseos-anteriores.png', 0, [(732, 206, 1029, 438)]),
    (21, 'bebras-2024-21-tour-bosque-solution.png', 0, [(609, 820, 997, 961)]),
    (22, 'alfred-alfombra-roja.png', 0, [(690, 191, 866, 379)]),
    (23, 'tarjetas-validas-manuel.png', 0, [(304, 249, 751, 404)]),
    (23, 'tarjeta-nueva-ana.png', 0, [(732, 438, 869, 657)]),
    (30, 'tubo_cuentas.png', 0, [(581, 540, 1012, 667)]),
    (32, 'bebras-2024-32-amigos-solution.png', 0, [(643, 765, 980, 873)]),
    (33, 'bebras-2024-33-red-trenes-solution.png', 0, [(802, 707, 1006, 821), (768, 763, 818, 781)]),
    (35, 'bebras-2024-35-escondiendo-comida-solution.png', 1, [(683, 219, 931, 407)]),
    (36, 'diagrama-cruz-robot.png', 0, [(410, 586, 528, 700)]),
    (38, 'bebras-2024-38-imagenes-encriptadas-solution.png', 1, [(601, 679, 978, 795)]),
    (41, 'pared_original.png', 0, [(568, 332, 1004, 457)]),
    (42, 'bebras-2024-42-mapas-falsos-solution.png', 0, [(198, 773, 439, 948)]),
    (43, 'bebras-2024-43-palago-solution.png', 1, [(589, 227, 992, 350), (588, 361, 717, 482), (583, 495, 761, 632)]),
]
# Bolitas de la sonaja (tarea 12): en el PDF se tocan con sus vecinas, asi que
# se vuelven a dibujar sus trazos sobre fondo transparente. Esquina superior izquierda.
BALLS = [
    ('bolita-roja.png', (745.3, 907.1)),
    ('bolita-amarilla.png', (774.6, 910.4)),
    ('bolita-azul.png', (824.4, 885.1)),
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



def figure(document, page_index, regions, zoom=4):
    page = document[page_index]
    scale = page.rect.width / 1100
    bounds = fitz.Rect(regions[0])
    for region in regions[1:]:
        bounds |= fitz.Rect(region)
    # Directo de la pagina: show_pdf_page oscurece algunas imagenes con mascara.
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=bounds * scale, alpha=False)
    image = Image.open(io.BytesIO(pixmap.tobytes('png'))).convert('RGB')
    if len(regions) > 1:
        k = zoom * scale
        mask = Image.new('L', image.size, 0)
        draw = ImageDraw.Draw(mask)
        for x0, y0, x1, y1 in regions:
            draw.rectangle([(x0 - bounds.x0) * k, (y0 - bounds.y0) * k,
                            (x1 - bounds.x0) * k, (y1 - bounds.y0) * k], fill=255)
        image = Image.composite(image, Image.new('RGB', image.size, 'white'), mask)
    output = io.BytesIO()
    image.save(output, 'PNG', optimize=True)
    return output.getvalue()


def ball(document, page_index, corner, size=26.1, pad=0.6, zoom=10):
    page = document[page_index]
    scale = page.rect.width / 1100
    box = fitz.Rect(corner[0], corner[1], corner[0] + size, corner[1] + size) * scale
    box = fitz.Rect(box.x0 - 0.3, box.y0 - 0.3, box.x1 + 0.3, box.y1 + 0.3)
    shift = fitz.Point(box.x0 - pad * scale, box.y0 - pad * scale)
    with fitz.open() as output:
        target = output.new_page(width=box.width + 2 * pad * scale, height=box.height + 2 * pad * scale)
        for drawing in page.get_drawings():
            # El hueco de la sonaja (casi blanco, borde gris) no es parte de la bolita.
            fill = drawing.get('fill')
            if not box.contains(drawing['rect']) or fill is None or min(fill) > 0.98:
                continue
            shape = target.new_shape()
            for item in drawing['items']:
                if item[0] == 'l':
                    shape.draw_line(item[1] - shift, item[2] - shift)
                elif item[0] == 'c':
                    shape.draw_bezier(*(p - shift for p in item[1:5]))
                elif item[0] == 're':
                    shape.draw_rect(fitz.Rect(item[1]) - (shift.x, shift.y, shift.x, shift.y))
                elif item[0] == 'qu':
                    shape.draw_quad(fitz.Quad(*(p - shift for p in item[1])))
            shape.finish(fill=fill, color=drawing.get('color'), width=drawing.get('width') or 0,
                         closePath=drawing.get('closePath', False), even_odd=drawing.get('even_odd', False),
                         fill_opacity=drawing.get('fill_opacity') or 1)
            shape.commit()
        return target.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True).tobytes('png')


def replace(task, name, png):
    matches = [img for img in images(task) if img.get('name') == name]
    if not matches:
        raise ValueError(f'Recurso ausente: {task["id"]} {name}')
    # Una pieza de arrastre puede repetirse: todas llevan la misma imagen.
    for img in matches:
        img['url'] = 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')


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
        for number, name, offset, regions in FIGURES:
            replace(by_number[number], name, figure(document, pages[number] + offset, regions))
        for name, corner in BALLS:
            replace(by_number[12], name, ball(document, pages[12], corner))
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
    print(f'{len(CROPS) + len(FIGURES) + len(BALLS) + 1} imagenes actualizadas.')


if __name__ == '__main__':
    main()
