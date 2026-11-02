# poster.json example

A filled-in spec after step 3 and a first `draw`. Paths are relative to the file.

```json
{
  "title": "Game Day",
  "subtitle": "Family",
  "footnote": "",
  "about": "Three kids: Maya (soccer goalie), Theo (baseball), June. We're a camping family.",
  "format": "18x24",
  "style": "illustrated",
  "items": [
    {
      "photo": "photos/01-bottles.jpg",
      "preview": "previews/01-bottles.jpg",
      "name": "Water Bottles",
      "caption": "We have 100",
      "notes": "Two weathered bottles: a tall mint insulated bottle with a brown SKI BUM sticker and a red USA sticker, and a red metal kid bottle with chipped paint and a green spout cap.",
      "size": "M",
      "art": "art/01-water-bottles.jpg",
      "artCheck": "clean"
    },
    {
      "photo": "photos/05-bat-and-glove.jpg",
      "preview": "previews/05-bat-and-glove.jpg",
      "name": "Baseball",
      "caption": "A passion for Theo, despite our soccer family push",
      "notes": "A bright yellow and red youth baseball bat with brown grip tape, and a tan leather glove with dark lacing. Both must appear; no ball.",
      "size": "L",
      "crop": { "x": 0.15, "y": 0.2, "w": 0.7, "h": 0.65 },
      "art": "art/05-baseball.jpg",
      "artCheck": "clean"
    }
  ]
}
```

Fields the script writes: `photo`, `preview` (prepare), `art`, `artCheck` (`clean` or `background-left`), `drawError` (draw). Everything else is yours to edit.

`footnote` prints small at the bottom ("Collected by the Harper family, 2026"). Leave it empty for none.
