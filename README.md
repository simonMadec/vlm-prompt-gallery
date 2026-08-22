# Prompt comparison gallery

Live site: **https://simonmadec.github.io/vlm-prompt-gallery/**

Side-by-side VLM predictions across prompt variants (hierarchical, hierarchical EN, GT-aligned) on Benin street-view plots.

## Refresh after a new run

From the analysis folder in `plant_street_view`:

```bash
./publish_prompt_gallery.sh
```

That rebuilds the static site with copied images (`--portable`), commits, and pushes. GitHub Pages updates the same URL in about a minute.

Optional: `GALLERY_REPO=/path/to/this/clone ./publish_prompt_gallery.sh --folder /path/to/prompt/runs`
