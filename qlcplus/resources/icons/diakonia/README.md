# Logo Diakonia

Gerados a partir de `Logo Diakonia Tulipas.pdf` (Photoshop, 1605×455), usando a máscara de transparência do PDF e recolorindo:

| Arquivo | Uso |
|---|---|
| `diakonia-logo.png` | logo completo claro: tela Sobre e marca d'água das páginas do Virtual Console |
| `diakonia-symbol.png` | só o livro, claro, quadrado: botão Actions da barra superior |
| `diakonia-icon.png` / `diakonia.ico` | livro escuro sobre quadrado branco: ícone da janela, do `.exe` (`qmlui/qmlui.rc`) e do instalador |

Para gerar de novo (Node.js):

```bash
node extract.cjs "Logo Diakonia Tulipas.pdf" /tmp/logo     # extrai as máscaras (objetos 21 e 31 do PDF)
node gen.cjs /tmp/logo out                                  # gera PNGs e o .ico em out/
```
