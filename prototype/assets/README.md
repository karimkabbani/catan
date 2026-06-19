# Custom art — drop-in assets

The board renders its own original artwork by default. If you want to use your
own tile images instead (for example, crops you make yourself from your own
screenshots, for your private game), this folder is where they go. No code
changes needed.

## How it works

The game looks for `window.CATAN_ASSETS`. If it lists an image for a terrain,
that image is drawn (clipped to the hexagon) instead of the built-in art.

1. Put square-ish images in `assets/tiles/`, one per terrain:
   `wood.png`, `brick.png`, `sheep.png`, `wheat.png`, `ore.png`, `desert.png`
   (≈ 400×400px or larger works well; they're center-cropped to the hex.)

2. Add this `<script>` in `index.html` **before** `app.js`:

```html
<script>
  window.CATAN_ASSETS = {
    tiles: {
      wood:   'assets/tiles/wood.png',
      brick:  'assets/tiles/brick.png',
      sheep:  'assets/tiles/sheep.png',
      wheat:  'assets/tiles/wheat.png',
      ore:    'assets/tiles/ore.png',
      desert: 'assets/tiles/desert.png',
    },
  };
</script>
```

Leave out any terrain you don't have an image for — it falls back to the drawn
art automatically. You can mix and match.

## A note on the source art

I (Claude) draw the built-in tiles as original artwork, and I keep that art
swappable like this so you can supply your own images. The painted tiles in the
official app are the original artist's copyrighted work, so I don't extract or
embed those for you — that part is yours to handle with your own files if you
choose. The drop-in system above means whatever you place here just works.
