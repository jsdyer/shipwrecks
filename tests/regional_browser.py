"""Check the built regional explorer in Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
def run():
    directory = ROOT / 'browser-checks'
    directory.mkdir(exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=ROOT/'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                page = browser.new_page(viewport={'width': 1240, 'height': 900})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('https://tile.openstreetmap.org/**', lambda route: route.abort())
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.locator('.wreck-row').first.wait_for()
                page.get_by_role('button', name='Tobermory wrecks').click()
                assert page.locator('#region').input_value() == 'ON'
                assert page.locator('#status').inner_text() == '18 records'
                page.locator('#query').fill('Arabia')
                page.get_by_role('button', name='Arabia', exact=True).click()
                assert '1884' in page.locator('#record-body').inner_text()
                assert page.locator('#record-body a').filter(has_text='Parks Canada').count() == 1
                page.get_by_role('button', name='Show on map').click()
                page.locator('#map-filter').check()
                assert page.locator('#status').inner_text() == '1 record'
                page.locator('#map-filter').uncheck()
                page.locator('#query').fill('')
                page.locator('#map-home').click()
                page.locator('#map').screenshot(path=directory/'tobermory-map.png')
                page.screenshot(path=directory/'desktop.png', full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=directory/'mobile.png', full_page=True)
                assert not errors, errors
                browser.close()
        finally:
            server.shutdown()

if __name__ == '__main__':
    run()
