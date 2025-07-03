# Development Guidelines

This is an assorted list of guidelines when developing code; generally everyone should try to stick with how we usually do things, but here's also an explicit list of things which are considered good practise.

## Handling assets

- Optimise image assets before inclusion; e.g. use gimp, scale the image, and then export as .webp file in 70% quality. Will help tremendously on especially slower mobile devices. This sometimes takes raw 1mb images down to 40kb, so it's well worth it.

## Performance Considerations

- Be mindful of introducing new fields, either in data models, or in json fields like questData, effects, etc. If a new field/stored data can be avoided, this is always better. Always consider: what if we have 100X the current load.

## UX Considerations

- When creating/changing UI, always try it across all screen widths, ensuring that it's responsive and good-looking across devices.
