# Design resource decisions

Reviewed official repository pages on 26 October 2026. No third-party skill was installed or executed, no remote instructions were treated as repository instructions, and no external assets were copied. The existing Express/plain-JavaScript stack remains.

| Resource / maintainer | Evaluation | Decision |
|---|---|---|
| [GSAP / GreenSock](https://github.com/greensock/GSAP) | Animation library; license and terms require separate review before adoption | Not installed; no interaction requires it |
| [Lenis / darkroomengineering](https://github.com/darkroomengineering/lenis) | Smooth scrolling | Not installed; native operational scrolling retained |
| [React Bits / DavidHDev](https://github.com/DavidHDev/react-bits) | React components | Incompatible with current vanilla stack without unnecessary framework work; not adopted |
| [Impeccable / pbakaus](https://github.com/pbakaus/impeccable), [license](https://github.com/pbakaus/impeccable/blob/main/LICENSE) | Design guidance repository and license reviewed at source level | Not installed/executed or copied; local DESIGN.md defines the product's own guidance |
| [Taste Skill / Leonxlnx](https://github.com/Leonxlnx/taste-skill) | Art-direction/reference and browser-review guidance | Not adopted; source instructions not executed |
| [Emil Kowalski skills](https://github.com/emilkowalski/skills) | Design/engineering skills | Not installed; no Claude hooks assumed compatible |
| [Awesome Design MD / VoltAgent](https://github.com/VoltAgent/awesome-design-md) | Design-system reference collection; match to video's name remains an inference | No vendor system copied; local identity retained |
| [Playwright / Microsoft](https://github.com/microsoft/playwright), [Apache-2.0 license](https://github.com/microsoft/playwright/blob/main/LICENSE) | Already installed and compatible with Node/plain HTML | Selected existing dependency; headless Edge workflow and screenshots executed. No new installation needed |

The installed Sites skill is for Sites creation/hosting, so it does not apply to this repository upgrade. No raster generation was needed. Native browser tests use the existing Playwright dependency, not Windows UI automation.

## TikTok references

All four supplied short URLs were attempted with the web reader and were inaccessible:

- https://vt.tiktok.com/ZSg4rd3RD/
- https://vt.tiktok.com/ZSg4hACmw/
- https://vt.tiktok.com/ZSg4hUrFE/
- https://vt.tiktok.com/ZSg4h6Yus/

Their captions/slides were not independently observed in this session. The supplied document's account of captions is background, not verified content. In particular, no tools were invented for the inaccessible photo post. Screenshot iteration, reduced-motion checks and restrained CSS were applied independently.
