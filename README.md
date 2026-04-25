# mcp-screenshot

[Русская версия ниже / Russian version below](#mcp-screenshot-ru)

A small Model Context Protocol (MCP) server that gives an LLM eyes on your
desktop **without burning context**. It can take one-off screenshots, crop a
region around the mouse cursor, and run **timed streaming sessions** that save
frames to disk and only return image bytes when explicitly asked.

## Why this exists

Most LLM workflows that need to "look at the screen" either:

1. Drop a full-resolution PNG into the model context every call — which
   eats tokens fast and slows the conversation.
2. Run a separate vision pipeline that the model can't directly query.

This server takes a middle road. Captures are persisted to disk; the MCP tools
return small metadata blobs (`filePath`, `bytes`, dimensions, cursor info)
plus the image only when you ask for `includeBase64=true` or call
`stream_latest`. Streaming sessions keep a bounded ring of recent frames in
memory so a 5-minute capture session at 1 fps doesn't blow memory either.

It also exposes the **mouse cursor position and the title of the window under
the cursor**, so the model can ground its analysis ("you are looking at the
window titled X at the top-right of the screen") without guessing.

## Tools

| Tool              | What it does                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| `screenshot`      | One-shot capture. Optional cursor-region crop, format, quality, resize.   |
| `cursor_info`     | Cursor coords + foreground window + window directly under the cursor.    |
| `stream_start`    | Start a timed periodic capture (interval + duration).                     |
| `stream_status`   | Snapshot of a session: frame count, time remaining, recent frames.       |
| `stream_latest`   | Read the most recent frame from disk and return it as base64.            |
| `stream_stop`     | Stop a running session early. Frames already on disk are kept.           |
| `stream_list`     | List all known sessions.                                                  |
| `stream_drop`     | Forget a finished session (frees its in-memory ring).                    |

Defaults are tuned for legibility on 4K monitors:

* Single screenshots — JPEG, quality 82, longest edge **2400px**.
* Streams — JPEG, quality 72, longest edge **1920px**.
* When `cursorRadius>0` the cursor crop is kept at native resolution
  (no resize) unless you override `maxEdge` explicitly.

Pass `maxEdge: 0` to disable resizing entirely; pass any positive value
to override.

## Install

```bash
git clone https://github.com/beekamai/mcp-screenshot.git
cd mcp-screenshot
npm install
npm run build
```

Wire it into any MCP-capable client by pointing it at `node dist/index.js`
over stdio. Most CLI-based clients have an `mcp add` subcommand:

```bash
your-mcp-client mcp add screenshot --scope user -- node /absolute/path/to/mcp-screenshot/dist/index.js
```

## Platform notes

* **Windows**: uses `System.Drawing` via PowerShell. No native binaries
  shipped. Cursor probe and screen capture both work without admin rights.
  Multi-monitor selection is supported via the `display` argument
  (0 = first monitor, omit = full virtual screen).
* **macOS / Linux**: capture falls back to `screenshot-desktop` if installed.
  The cursor probe currently only reports `x = -1, y = -1` outside of Windows;
  contributions welcome.

## Privacy

Everything is local. The server runs as a stdio process, captures are saved
under `./captures/` next to the package by default, and nothing is sent over
the network unless your MCP client transports the bytes. Delete the
`captures/` directory when you're done.

## License

MIT.

---

<a id="mcp-screenshot-ru"></a>

# mcp-screenshot (RU)

Небольшой MCP-сервер, который даёт языковой модели возможность **видеть
рабочий стол, не съедая контекст**. Он умеет делать одиночные скриншоты,
вырезать область вокруг курсора и запускать **сессии покадрового стриминга**,
которые пишут кадры на диск и возвращают пиксели только тогда, когда модель
явно их запросила.

## Зачем это нужно

Стандартные подходы к "смотри на экран":

1. Передавать модели каждый раз PNG в полный размер — токены кончаются
   быстро, и диалог становится тормозным.
2. Использовать отдельный vision-конвейер, к которому модель не имеет
   прямого доступа.

Этот сервер идёт средним путём: каждый снимок сохраняется на диск, а MCP-тулы
возвращают компактный JSON (`filePath`, размер файла, разрешение,
информация о курсоре). Изображение приходит в ответе только если в `screenshot`
передан `includeBase64=true` или если позже вызван `stream_latest`. У стримов
есть ограниченное кольцо последних кадров в памяти, так что пятиминутная
сессия с частотой 1 fps не разнесёт RAM.

Дополнительно сервер сообщает **координаты курсора и заголовок окна под
ним** — модель может опираться на это, не угадывая ("ты сейчас смотришь
на окно X в правом верхнем углу").

## Тулы

| Тул               | Что делает                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `screenshot`      | Одиночный снимок. Опционально — обрезка вокруг курсора, формат, качество.     |
| `cursor_info`     | Координаты курсора, активное окно и окно под курсором.                         |
| `stream_start`    | Запуск таймера с периодической съёмкой (интервал + длительность).              |
| `stream_status`   | Снимок состояния сессии: число кадров, остаток времени, последние кадры.       |
| `stream_latest`   | Прочитать последний кадр с диска и вернуть base64.                             |
| `stream_stop`     | Прервать сессию досрочно. Кадры на диске сохраняются.                          |
| `stream_list`     | Список всех сессий.                                                             |
| `stream_drop`     | Забыть завершённую сессию (освобождает кольцо в памяти, файлы остаются).       |

Дефолты подобраны под 4K-мониторы — текст на интерфейсах остаётся читаемым:

* Одиночные снимки — JPEG, качество 82, длинная сторона **2400px**.
* Стримы — JPEG, качество 72, длинная сторона **1920px**.
* При `cursorRadius>0` обрезка вокруг курсора сохраняется в нативном
  разрешении (без ресайза), если явно не задан `maxEdge`.

`maxEdge: 0` полностью отключает уменьшение, любое положительное значение —
переопределяет дефолт.

## Установка

```bash
git clone https://github.com/beekamai/mcp-screenshot.git
cd mcp-screenshot
npm install
npm run build
```

Подключение к любому MCP-клиенту — указать запуск `node dist/index.js`
через stdio. У большинства CLI-клиентов есть подкоманда `mcp add`:

```bash
your-mcp-client mcp add screenshot --scope user -- node /абсолютный/путь/к/mcp-screenshot/dist/index.js
```

## Платформы

* **Windows**: захват через `System.Drawing` (вызов из PowerShell), без
  бандленных нативных бинарей. Курсорный пробник и скриншоты работают без
  прав администратора. Мульти-мониторный выбор — параметр `display`
  (`0` — первый монитор, без аргумента — весь виртуальный экран).
* **macOS / Linux**: захват — fallback на `screenshot-desktop`. Курсорный
  пробник сейчас возвращает `x = -1, y = -1` вне Windows; PR приветствуются.

## Приватность

Всё локально. Сервер крутится как stdio-процесс, кадры лежат в `./captures/`
рядом с пакетом, ничего не уходит в сеть, пока ваш MCP-клиент сам не передаст
байты дальше. После работы — просто удалите каталог `captures/`.

## Лицензия

MIT.
