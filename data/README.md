# Optional domain lists

Files here extend the built-in datasets at boot. Both are optional, plain text,
one domain per line; blank lines and `#` comments are ignored.

| File | Merged into |
|------|-------------|
| `disposable.txt` | Disposable / burner providers, scored as `risky` |
| `free.txt` | Free consumer providers, flagged but not penalised |

The built-in disposable list covers roughly 170 of the most common providers.
For full coverage, import a maintained list:

```bash
curl -sL https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf \
  -o data/disposable.txt
```

Restart the app afterwards; it logs how many domains were merged.

On Netlify these files are bundled with the function via `included_files` in
`netlify.toml`. If a list fails to load there, the app logs a warning and falls
back to the built-in sets rather than failing the request.
