import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Topography from './terrain/Topography';
import './focus.css';

function Focus() {
  const [staticMode, setStaticMode] = useState(false);
  const [accessibleMode, setAccessibleMode] = useState(true);
  const backdrop = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const product = useRef<HTMLPictureElement>(null);
  useEffect(() => {
    const scene = hero.current;
    const window = product.current;
    if (!scene || !window) return;
    const placeLight = () => {
      const area = scene.getBoundingClientRect();
      const frame = window.getBoundingClientRect();
      // One light belongs to the whole scene, anchored below the product rather
      // than painted into a rectangular pseudo-element around its perimeter.
      const visibleWidth = Math.min(frame.width, area.right - frame.left);
      scene.style.setProperty('--stage-light-x', `${frame.left - area.left + visibleWidth * .52}px`);
      scene.style.setProperty('--stage-light-y', `${frame.bottom - area.top + 24}px`);
      scene.style.setProperty('--stage-light-width', `${Math.max(visibleWidth * .85, 260)}px`);
      scene.style.setProperty('--stage-light-height', `${Math.max(frame.height * .55, 160)}px`);
    };
    const observer = new ResizeObserver(placeLight);
    observer.observe(scene);
    observer.observe(window);
    placeLight();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(prefers-contrast: more)'),
    ];
    const update = () => setAccessibleMode(preferences.some(preference => preference.matches));
    update();
    preferences.forEach(preference => preference.addEventListener('change', update));
    return () => preferences.forEach(preference => preference.removeEventListener('change', update));
  }, []);
  const active = !staticMode && !accessibleMode;
  function pulse() {
    const canvas = backdrop.current?.querySelector('canvas');
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    // The same pointer path is available from a keyboard-operated preview control.
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: bounds.left + bounds.width * .57,
      clientY: bounds.top + bounds.height * .62,
      pointerType: 'touch',
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  }
  return <>
    <a className="skip" href="#hero">К прототипу</a>
    <div className="review-bar">
      <a href="http://127.0.0.1:4401/a.html">Статический вариант A</a>
      <span className="prototype-label">Фокус: интерактивный прототип</span>
      <button type="button" disabled={!active} onClick={pulse}>Показать волну</button>
      <button type="button" aria-pressed={staticMode} onClick={() => setStaticMode(value => !value)}>Статичный фон</button>
    </div>
    <main>
      <section className="hero" id="hero" ref={hero} aria-label="Прототип первого экрана Фокус">
        <div className={`focus-backdrop ${active ? 'is-live' : ''}`} aria-hidden="true" ref={backdrop}>
          <div className="fallback-contours" />
          {active && <Topography
            color="#0297DE" lineCount={22} lineWidth={1.15} elevation={.85}
            foreground={.2} tilt={32} speed={.055} morph={.04}
            glow={.12} depthOfField={0} fog={.25} brightness={1.15}
            mouseInteraction hoverEffect="lift" mouseRadius={1.25}
            mouseStrength={.95} trail={.4} parallax={.15}
            clickEffect="pulse" markers="none" glitch={0} intro={false} dpr={.85}
          />}
        </div>
        <header className="site-nav">
          <a className="brand" href="#hero"><img src="/assets/logo.svg" alt="" width="25" height="25" />WatchDemo</a>
          <nav aria-label="Навигация прототипа"><a href="#product">Приложение</a><a href="#next">Возможности</a><a href="#notes">О прототипе</a></nav>
          <span className="platform">Для Windows</span>
        </header>
        <div className="hero-layout">
          <div className="hero-copy">
            <h1>Разбор матча.<br />Всё в одном месте.</h1>
            <p className="lead">Библиотека демок, моменты, свои наборы и 2D-реплей. Соберите разбор в WatchDemo и смотрите демо прямо в CS2.</p>
            <div className="actions">
              <a className="primary" href="#notes">Скачать для Windows <span aria-hidden="true">↓</span></a>
              <a className="secondary" href="#next">Посмотреть возможности</a>
            </div>
          </div>
          <div className="product-area" id="product">
            <figure className="product" tabIndex={0} aria-label="Исходный интерфейс приложения, доступна горизонтальная прокрутка">
              <picture ref={product}><source media="(max-width:767.98px)" srcSet="/assets/mobile-a.webp" /><img src="/assets/desktop-a.webp" width="1280" height="800" alt="Цветовой эскиз на исходном интерфейсе WatchDemo: библиотека Falcons против Spirit, исходные матчи и наборы сохранены" /></picture>
              <figcaption>Исходный интерфейс. Цветовой эскиз.<span className="mobile-hint"> Прокрутите изображение по горизонтали.</span></figcaption>
            </figure>
          </div>
        </div>
        <div className="hero-bottom"><p className="interaction-hint"><span className="mouse-hint">Проведите курсором по рельефу. Нажмите, чтобы пустить волну.</span><span className="touch-hint">Коснитесь рельефа, чтобы пустить волну. Прокрутка страницы остаётся обычной.</span></p><a href="#next">Что будет дальше <span aria-hidden="true">↓</span></a></div>
      </section>
      <section className="flow" id="next"><div><p className="study-label">Дальше по странице</p><h2>Настоящие материалы.<br />Два отдельных эпизода.</h2></div><div className="flow-copy"><h3>Открытие демо в CS2</h3><p>Здесь появится настоящая запись WatchDemo → CS2. Без выдуманной игры и без подмены времени загрузки.</p><h3>Исходный 2D-повтор</h3><p>Отдельная крупная сцена с исходным раундом Falcons против Spirit на Mirage. Её данные и содержимое не меняются. В этом прототипе она ещё не перенесена.</p></div></section>
      <section className="notes" id="notes"><h2>Что проверяем в прототипе</h2><p>Композицию A, настоящий интерактивный ReactBits Topography, подъём под курсором и волну по нажатию. Рельеф не блокирует ссылки, выделение текста и прокрутку. При reduced motion, reduced transparency или повышенном контрасте используется статическая версия.</p><p>Это отдельный прототип, не новая версия сайта. Кнопка скачивания намеренно ведёт к этому пояснению и ничего не скачивает. Изображение приложения является цветовым эскизом исходного скриншота, а не работающей desktop-сборкой.</p><p><a href="http://127.0.0.1:4401/">Вернуться к сравнению трёх направлений</a></p></section>
    </main>
  </>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Focus prototype root is missing');
createRoot(root).render(<StrictMode><Focus /></StrictMode>);
