TwineJS modded repo.

Extensions:
- Sliders format
- scene editor in YAML
- character editor

After each larger unit of work, commit, push, auto deploy with `npm run deploy-cloudflare`

Commit struct:
```
short keyword summary title

- changes in list or short prose, caveman style

```

Always communicate caveman, be to the point, short, conscise sentences.

Use tmp for anything temporary, like agent browser, puppeteer screenshots, testing, temporary files.

## Changing the story format

`format/` is Chapbook vendored plus the Sliders layer. **Before you finish a change under
`format/`, check the previous functionality is still there — the CodeMirror ones above
all** (scene toolbar menu, scene syntax highlighting, scene commands, story-map arrows
from a scene's `links:`). They are silent when lost: the format still builds, loads and
plays; the passage editor just turns back into Chapbook's.

0.2.0 shipped exactly that way — the re-vendor took the editor extensions with it. Read
`format/README.md`, "Do not lose the Sliders half", before touching that directory, and
run `npm run build:format` plus `npx jest format/src/twine-extensions`.
