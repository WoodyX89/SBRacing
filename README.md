# SB Racing — Medicine Hat Mountain Bike Club

Multi-page static website for SB Racing (Soggy Bottom Racing).

## Pages

| File | Description |
|------|-------------|
| `index.html` | Home / landing (hero + stats + about teaser) |
| `about.html` | Full club story & values |
| `merch.html` | Merchandise store with cart |
| `events.html` | Upcoming rides & RSVP |
| `join.html` | Membership tiers + signup form |
| `members.html` | Members-only area (login + dashboard) |

## Structure

```
.
├── index.html
├── about.html
├── merch.html
├── events.html
├── join.html
├── members.html
├── assets/
│   └── logo.JPG          # put your logo here
├── css/
│   └── styles.css
├── js/
│   └── shared.js         # nav, cart, toast helpers
└── README.md
```

## Deploying to Cloudflare Pages

1. Push this folder to a GitHub repo
2. In Cloudflare Dashboard → Pages → Create project → Connect to Git
3. Build settings:
   - **Framework preset**: None
   - **Build command**: (leave empty)
   - **Build output directory**: `/` (or leave default)
4. Deploy — usually live in under 2 minutes

## Notes

- Cart is stored in `localStorage` so it persists across pages
- All interactive features (cart, RSVP, membership, login) are client-side demos
- Logo: place `logo.JPG` in the `assets/` folder
