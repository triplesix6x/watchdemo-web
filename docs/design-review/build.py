"""Rebuild isolated visual studies from original assets. Does not edit product files."""
from pathlib import Path
from shutil import copyfile
import colorsys
import math
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ASSETS = HERE / 'assets'
ASSETS.mkdir(exist_ok=True)
fonts = ROOT / 'frontend/node_modules/@fontsource/onest/files'
for script in ('latin', 'cyrillic'):
    for weight in (400, 600, 700):
        copyfile(fonts / f'onest-{script}-{weight}-normal.woff2', ASSETS / f'onest-{script}-{weight}.woff2')
copyfile(ROOT / 'frontend/public/brand/logo-symbol.svg', ASSETS / 'logo.svg')
copyfile(ROOT / 'frontend/public/screens/app-home.webp', ASSETS / 'original.webp')

# A palette study on the real screenshot: positions, text and data are unchanged.
original = Image.open(ASSETS / 'original.webp').convert('RGB')
for key, blue_bias in [('a', 0.018), ('b', 0.032), ('c', 0.024)]:
    mapped = []
    for r, g, b in original.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        source = (r / 255, g / 255, b / 255)
        neutral_weight = max(0, 1 - s / .5) * min(1, max(0, (.6 - v) / .3))
        value = v * .80
        neutral = (max(0, value - blue_bias), value + blue_bias * .45, value + blue_bias * 1.5)
        target = tuple(a + (b - a) * neutral_weight for a, b in zip(source, neutral))
        hue_weight = max(0, 1 - abs(h - .60) / .10)
        blue_weight = hue_weight * min(1, max(0, (s - .15) / .3)) * min(1, max(0, (v - .15) / .3))
        # Smooth masks avoid posterized patches in compressed source imagery.
        blue = colorsys.hsv_to_rgb(.557, s, v * .86)
        target = tuple(a + (b - a) * blue_weight for a, b in zip(target, blue))
        mapped.append(tuple(round(min(1, max(0, c)) * 255) for c in target))
    image = Image.new('RGB', original.size)
    image.putdata(mapped)
    image.save(ASSETS / f'desktop-{key}.webp', quality=94)
    image.crop((390, 48, 1200, 510)).save(ASSETS / f'mobile-{key}.webp', quality=94)

# Static contour composition study, NOT the interactive ReactBits implementation.
w, h, step = 1600, 1000, 12
nx, ny = w // step + 1, h // step + 1
field = []
for y in range(ny):
    row = []
    for x in range(nx):
        u, v = x * step / w, y * step / h
        value = 0.22 * math.sin(u * 8 + v * 3) + 0.16 * math.sin(v * 11 - u * 5)
        value += 1.5 * math.exp(-((u - .86) ** 2 / .07 + (v - .36) ** 2 / .10))
        value += .95 * math.exp(-((u - .12) ** 2 / .045 + (v - .9) ** 2 / .08))
        value -= .7 * math.exp(-((u - .45) ** 2 / .12 + (v - .5) ** 2 / .12))
        row.append(value)
    field.append(row)
paths = []
for level_index in range(30):
    level = -.6 + level_index * .075
    segments = []
    for y in range(ny - 1):
        for x in range(nx - 1):
            points = [(x * step, y * step, field[y][x]), ((x + 1) * step, y * step, field[y][x + 1]), ((x + 1) * step, (y + 1) * step, field[y + 1][x + 1]), (x * step, (y + 1) * step, field[y + 1][x])]
            hits = []
            for i in range(4):
                p, q = points[i], points[(i + 1) % 4]
                if (p[2] < level) != (q[2] < level):
                    t = (level - p[2]) / (q[2] - p[2])
                    hits.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
            for i in range(0, len(hits) - 1, 2):
                a, b = hits[i:i + 2]
                segments.append(f'M{a[0]:.1f},{a[1]:.1f}L{b[0]:.1f},{b[1]:.1f}')
    paths.append(f'<path d="{"".join(segments)}" stroke-width="{1.6 if level_index % 5 == 0 else .85}" opacity="{.75 if level_index % 5 == 0 else .45}"/>')
(ASSETS / 'terrain.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><g fill="none" stroke="#0297DE">' + ''.join(paths) + '</g></svg>')

concepts = {
 'a': ('Фокус', 'От общей библиотеки к нужному моменту.', 'Разбор матча.<br>Всё в одном месте.', 'Две ясные области: смысл слева, настоящий продукт справа. Оранжевая планка связывает интерфейс с инструментами разбора.'),
 'b': ('Пространство разбора', 'Весь продукт на одной рабочей плоскости.', 'Разбор матча.<br>Всё в одном месте.', 'Широкий настоящий интерфейс, воздух вокруг типографики и видимый рельеф по краям. Самый продуктовый из трёх вариантов.'),
 'c': ('Слои матча', 'Разные способы изучить одну демку.', 'Разбор матча.<br>Всё в одном месте.', 'Открытая асимметричная сетка. Инструменты образуют отдельную оранжевую ось рядом с настоящим интерфейсом.'),
}
lead = 'Библиотека демок, моменты, свои наборы и 2D-реплей. Соберите разбор в WatchDemo и смотрите демо прямо в CS2.'
features = '<span>Библиотека</span><span>Моменты</span><span>Наборы</span><span>2D-реплей</span>'
nav = '<header class="site-nav"><a class="brand" href="#hero"><img src="assets/logo.svg" alt="" width="25" height="25">WatchDemo</a><nav aria-label="Навигация макета"><a href="#desktop">Приложение</a><a href="#flow">Возможности</a><a href="#notes">О макете</a></nav><span class="platform">Для Windows</span></header>'
actions = '<div class="actions"><a class="primary" href="#notes">Скачать для Windows <span aria-hidden="true">↓</span></a><a class="secondary" href="#flow">Посмотреть возможности</a></div>'
for key, (name, idea, headline, description) in concepts.items():
    product = f'<figure class="product" tabindex="0" aria-label="Скриншот приложения, на узком экране доступна горизонтальная прокрутка"><picture><source media="(max-width:767.98px)" srcset="assets/mobile-{key}.webp"><img src="assets/desktop-{key}.webp" width="1280" height="800" alt="Цветовой эскиз на исходном скриншоте WatchDemo: библиотека Falcons против Spirit, без изменения данных"></picture><figcaption>Исходный интерфейс. Цветовой эскиз.<span class="mobile-hint"> Прокрутите изображение по горизонтали.</span></figcaption></figure>'
    copy = f'<div class="hero-copy"><h1>{headline}</h1><p class="lead">{lead}</p>{actions}</div>'
    toolstrip = f'<div class="tools" aria-label="Инструменты WatchDemo">{features}</div>'
    body = f'<div class="hero-layout">{copy}<div class="product-area">{product}{toolstrip}</div></div>'
    if key == 'c':
        body = f'<div class="hero-layout">{copy}<div class="product-area">{toolstrip}{product}</div></div>'
    other = ''.join(f'<a href="{k}.html" {"aria-current=page" if key == k else ""}>{k.upper()}. {v[0]}</a>' for k, v in concepts.items())
    page = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{name} · WatchDemo · Визуальное исследование</title><link rel="stylesheet" href="review.css"></head>
<body class="concept-{key}"><a class="skip" href="#hero">К макету</a><div class="review-bar"><a href="index.html">Все направления</a><nav aria-label="Направления">{other}</nav><span>Статический макет, не рабочий сайт</span></div>
<main><section class="hero" id="hero" aria-label="Макет первого экрана"><div class="terrain" aria-hidden="true"></div>{nav}{body}<div class="hero-bottom"><span>Демки CS2. От библиотеки до просмотра в игре.</span><a href="#desktop">Общий язык сайта и приложения <span aria-hidden="true">↓</span></a></div></section>
<section class="study" id="desktop"><div class="study-heading"><div><p class="study-label">{key.upper()}. {name}</p><h2>Тот же WatchDemo.<br>Новая цветовая система.</h2></div><p>Сохраняем расположение элементов, названия матчей и содержимое. Здесь показана только палитра на исходном скриншоте, не новая сборка приложения.</p></div><img class="desktop-study" src="assets/desktop-{key}.webp" width="1280" height="800" alt="Desktop-цветовой макет: исходная библиотека и исходные матчи WatchDemo"><details><summary>Сравнить с исходным скриншотом</summary><img class="desktop-study" src="assets/original.webp" width="1280" height="800" alt="Неизменённый исходный скриншот WatchDemo"></details></section>
<section class="flow" id="flow"><div><p class="study-label">Дальше по странице</p><h2>Два доказательства.<br>Без подмены демо.</h2></div><div class="flow-copy"><h3>Из WatchDemo прямо в CS2</h3><p>Отдельный эпизод с настоящей записью запуска. Видеоматериал ещё предстоит снять, выдуманных игровых кадров здесь нет.</p><h3>Настоящий раунд в 2D</h3><p>Самостоятельная крупная скролл-сцена с исходными данными Falcons против Spirit на Mirage. На телефоне остаётся большим блоком, а не плавающей полосой.</p></div></section>
<section class="notes" id="notes"><h2>Что оцениваем сейчас</h2><p>{description}</p><p>Сравниваем композицию, масштаб продукта и баланс чёрного, синего и оранжевого. Контуры сейчас статические: это исследование видимости будущей интерактивной ReactBits Topography, а не её замена. Кнопка скачивания в макете ведёт сюда намеренно, файлы не скачивает.</p><div class="swatches"><span style="--swatch:#02070A">Midnight</span><span style="--swatch:#0297DE">Electric blue</span><span style="--swatch:#FC734D">Cantaloupe</span></div></section></main><footer class="review-footer"><a href="index.html">Сравнить три направления</a><span>Исходный продукт не изменён</span></footer></body></html>'''
    (HERE / f'{key}.html').write_text(page)

cards = ''.join(f'''<article class="direction"><a href="{key}.html"><img src="shots/{key}-desktop.png" width="1440" height="990" alt="Первый экран направления {key.upper()}: {item[0]}"><div class="direction-copy"><span>{key.upper()}</span><h2>{item[0]}</h2><p>{item[3]}</p><strong>Открыть макет</strong></div></a></article>''' for key, item in concepts.items())
(HERE / 'index.html').write_text(f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>WatchDemo · Три визуальных направления</title><link rel="stylesheet" href="review.css"></head><body class="overview"><main><header class="overview-heading"><a class="brand" href="index.html"><img src="assets/logo.svg" width="28" height="28" alt="">WatchDemo</a><p>Выбор визуального направления</p><h1>Один продукт.<br>Три композиции.</h1><p>Одинаковые Onest, палитра и реальные данные. Разный масштаб, ритм и способ показать приложение. Рабочие сайт и desktop не изменены.</p></header><div class="directions">{cards}</div><section class="overview-note"><h2>Как смотреть</h2><p>Откройте каждый вариант на компьютере и телефоне. Ниже первого экрана есть цветовой макет desktop и исходный скриншот для сравнения. Вариант B рекомендован как наиболее цельное представление всех инструментов, но выбирать можно любой.</p><p>Это статические исследования, не интерактивные прототипы. Здесь нет живой Topography, видео CS2 и настоящего скачивания. Их реализация начнётся после выбора направления.</p></section></main></body></html>''')
print('Built A/B/C studies in', HERE)
