from backend.frontend_meta import inject_brand_meta_into_index_html

INDEX_HTML = """<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Carregando...</title>
  </head>
  <body></body>
</html>
"""


def test_inject_brand_meta_replaces_title_and_adds_open_graph():
    html = inject_brand_meta_into_index_html(
        INDEX_HTML,
        title="Empresa Exemplo",
        description="Compre e venda cripto com segurança",
        image_url="https://example.com/logo.png",
        page_url="https://example.com/order/abc",
    )

    assert "<title>Empresa Exemplo</title>" in html
    assert 'property="og:title" content="Empresa Exemplo"' in html
    assert 'property="og:description" content="Compre e venda cripto com segurança"' in html
    assert 'property="og:image" content="https://example.com/logo.png"' in html
    assert 'property="og:url" content="https://example.com/order/abc"' in html
