# Association Services BCS — Responsive Website Redesign Preview

A proposed design for [Association Services BCS](https://associationservicesbcs.com/) in Bryan–College Station, Texas.

## View the design

This public repository is configured to publish a browser-viewable preview with GitHub Pages at:

**https://rolaand-jayz.github.io/just-a-test/**

If the link is not live yet, the repository owner must enable GitHub Pages under **Settings → Pages → Source: GitHub Actions**, then rerun the `Deploy website preview` workflow.

## Purpose

This is a **review concept**, not the live business website. The production website at associationservicesbcs.com has not been altered. Its forms and Owner Portal remain hosted on the original domain. All external links are intentional.

### Responsive commitments

- Desktop, ultrawide, tablet, and phone layouts have individually considered hierarchy, spacing, and navigation.
- The mobile menu, community directory search, keyboard access, and all internal anchor navigation work without dependencies.
- Visitors can reach the existing Owner Portal, resale certificate, architectural request, contact form, FAQs, and service information.
- The preview uses no third-party fonts, analytics, tracking scripts, or image hosting.

### Built-in safeguards

- No contact form is faked: contacting the company sends the visitor to its existing live form.
- The review environment carries a visible preview notice and `noindex,nofollow` metadata.
- Brand-informed illustrated assets are *concept artwork*, not the company's official logo or photographs.
- No client counts, rates, fees, or unsupported business claims have been invented.

### Technical shape

Plain HTML, CSS, and JavaScript. No build tools or dependencies.

```text
site/
  index.html
  styles.css
  app.js
  .nojekyll
  assets/
    door-mark.svg
    neighborhood.svg
.github/workflows/pages.yml
```

To view locally, open `site/index.html` in a browser. The page uses only relative paths for its assets.

## Before adopting as a production replacement

1. Have the business owner approve copy, links, artwork, and updated branding.
2. Replace concept artwork with approved original company assets and photography, if desired.
3. Decide whether to migrate the existing forms, content management, and portal links. They have deliberately **not** been copied into this static preview.
4. Run cross-browser/device tests and an accessibility audit before connecting the real domain.

## Source notes

Content and business information were adapted from public pages of [Association Services BCS](https://associationservicesbcs.com/) as reviewed October 24, 2026, including the About, Services, Communities, FAQ, and Contact pages.

### Prior repository contents

This repository previously contained a public website snapshot for Rescue 1 Movers. It was replaced at Rolaand's request, but remains recoverable in Git history prior to this commit.
