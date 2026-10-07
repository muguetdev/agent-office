# CH_OfficeAvatar: asset brief (Phase 0)

The master avatar every player character in agent-office is built from: one base body, one shared
skeleton, and modular hair, facial hair, glasses, tops, bottoms, shoes and accessories that swap at
runtime. This brief covers the base character; the customization library comes after it's approved.

```text
ASSET      CH_OfficeAvatar
CATEGORY   character, stylised biped (chibi office worker), modular kit of swappable parts on one skeleton
VIEWS      ref/concept_sheet.png is one 1448x1086 sheet; its turnaround panels are cropped to 252x520 with
           one shared scale and ground line (sheet y 110..630):
           - ref/front.png: front, az 0 el 0, lens 0 (treated as orthographic), subject 493 px of 520
             (0.948), ground (sole bottom) 15 px from the bottom (0.029)
           - ref/side.png: the sheet's side view faces screen-right (a LEFT view); mirrored to a right
             view, az 90 el 0, lens 0. Its crop also catches the neighbours' hands at both edges.
           - ref/back.png: back, az 180 el 0, lens 0
           - ref/threequarter.png: concept, about az 35 el 5, perspective, waving pose: likeness only,
             never proportions
           Callouts (hair, beard, glasses, outfits, colours, expressions, modular parts) are surface
           detail and the customization brief, not geometry to measure.
SCALE      height 1.55 m to the top of the hair (inferred: a stylised adult a little shorter than the
           game's 1.70 m collision capsule and 1.40 m eye height; seated hips 0.45 m fit the office's
           chairs). 493 px = 1.55 m, so 1 px = 3.14 mm.
PROPORTIONS (front, as fractions of total height H; from the 2x ruled crop, about ±1 percent)
           1  head, chin to top of hair            0.351
           2  skull, chin to top of skull (no hair) 0.30   (3.3 skulls tall: the brief's "3.5 to 4 heads,
                                                         head about 25 percent" read as the skull)
           3  chin height above ground             0.649
           4  eye line height                      0.771
           5  shoulder line height (hoodie)        0.609
           6  hoodie hem height                    0.355
           7  crotch height                        0.314
           8  fist centre height (arms relaxed)    0.325
           9  head width with ears                 0.337
           10 face width without ears              0.243
           11 hoodie width at the hem              0.274
           12 feet centre to centre                0.213
           13 shoe length (side view)              0.284
           14 shoe height                          0.122
           15 trouser leg width at the knee        0.122
PARTS      (construction and overlap order; all on one skeleton)
           1 Body: head, torso, arms, hands, legs as one deforming skin mesh (kept whole in the master;
             regions hidden under clothing cut only on export copies). Eyes (white + pupil), brows,
             mouth are separate small meshes so expressions and recolours stay independent.
           2 Ears: part of the head mesh.
           3 Hair: separate deforming-rigid mesh on the head bone (3 styles later).
           4 Top: T-shirt (white) under an open hoodie (blue) with hood, cuffs, hem band, drawstrings.
           5 Bottoms: straight casual trousers (navy), cuffless, falling onto the shoes.
           6 Shoes: chunky sneakers (white with blue sole stripe and side mark), one per foot.
           Pivots: neck, shoulders, elbows, wrists, hips, knees, ankles, toes at the joint centres
           the blockout places.
SILHOUETTE 1 big round head with a tall wavy hair mass and stick-out ears
           2 short, wide hoodie torso with puffy sleeves ending in big rounded fists
           3 straight, parallel trouser legs with a gap between them
           4 oversized flat-soled sneakers that stick out in front
           5 slight A-stance, arms hanging away from the body
MATERIALS  Skin: warm peach, matte, roughness 0.7, no wear. Hair: dark brown, soft satin, roughness
           0.55. PrimaryClothing (hoodie): saturated blue fleece, roughness 0.85. SecondaryClothing
           (tee, drawstrings): off-white cotton, roughness 0.85. Pants: navy cotton, roughness 0.8.
           Shoes: white leather-like, roughness 0.45, with blue accents (Accessories/Shoes accent).
           Eyes: near-black pupils, glossy, roughness 0.2. All flat colours, recoloured at runtime.
ARTICULATION humanoid rig family: root, pelvis, spine_01, spine_02, chest, neck, head, clavicle/upperarm/
           lowerarm/hand per side, thigh/shin/foot/toe per side, simplified fingers. IK for hands and
           feet in the control rig only. Sockets: head (hats), face (glasses), hands, chest (badge).
           Animation: Idle, Walk, Sit, Typing, Wave. Facial shape keys: Neutral, Smile, BigSmile,
           Surprised, Sad, Angry, Blink_Left, Blink_Right, Mouth_Open, plus simple talking shapes.
INFERRED   - real height (1.55 m), from the game's metrics, not the sheet
           - the far (left) side from the right view by symmetry; the right view itself is the
             sheet's left view mirrored
           - the top of the head and the shoe soles (no top or bottom view)
           - the body under the clothing (arms, torso, legs): built to stylised anatomy that fits
             the outfit, not seen anywhere in the sheet
           - the hand's open shape: the sheet shows relaxed fists and one waving open hand
TARGET     engine three.js (agent-office, WebGL, toon-shaded), GLB / glTF 2.0; budget: the brief's
           8,000 to 15,000 tris for the body with the base outfit and hair at LOD0, LOD1 about 50
           percent, LOD2 20 to 25 percent; 20 to 50 avatars on screen. Game cameras: first person,
           third person (about 4 m back), and the scale-model look (52 degrees down, 24 degree lens,
           about 40 m away). Subject height at typical gameplay distance: 96 px.
```

## Conflicts and decisions

- Head size: the text asks for 3.5 to 4 heads with the head about 25 percent of the height; the sheet
  measures 0.351 H with hair and about 0.30 H for the skull. Followed the sheet (the user named it the
  source of truth for proportions), with the head counted as the skull: 3.3 skulls.
- The sheet's three-quarter view is a waving concept: likeness and expression only.
