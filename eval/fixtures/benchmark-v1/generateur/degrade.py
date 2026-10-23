"""Transforme un PDF natif en PDF scanné (images seules, sans couche texte), avec défauts réalistes."""
import io, random
import numpy as np
import cv2
import img2pdf
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pdf2image import convert_from_path

FD = "/usr/share/fonts/truetype/dejavu/"


def _font(name, size):
    return ImageFont.truetype(FD + name, size)


def tampon(img, texte, centre, couleur=(190, 30, 40), angle=-12, taille=46, alpha=0.75, cadre=True, sous=None):
    """Tampon encreur : texte encadré, irrégulier, semi-transparent."""
    W, H = img.size
    calque = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lignes = [texte] + ([sous] if sous else [])
    f1, f2 = _font("DejaVuSans-Bold.ttf", taille), _font("DejaVuSans-Bold.ttf", int(taille * 0.5))
    tmp = Image.new("RGBA", (taille * len(texte) + 80, int(taille * 2.6) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    d.text((30, 18), texte, font=f1, fill=couleur + (255,))
    bb = d.textbbox((30, 18), texte, font=f1)
    bas = bb[3]
    if sous:
        d.text((30, bas + 8), sous, font=f2, fill=couleur + (255,))
        bas = d.textbbox((30, bas + 8), sous, font=f2)[3]
    if cadre:
        d.rounded_rectangle((14, 6, max(bb[2], 120) + 16, bas + 14), radius=10, outline=couleur + (255,), width=5)
    a = np.array(tmp)
    # encre irrégulière
    trous = np.random.rand(*a.shape[:2]) < 0.22
    a[..., 3] = np.where(trous, (a[..., 3] * 0.15).astype(np.uint8), a[..., 3])
    a[..., 3] = (a[..., 3] * alpha).astype(np.uint8)
    tmp = Image.fromarray(a).rotate(angle, expand=True, resample=Image.BICUBIC)
    x, y = int(centre[0] * W - tmp.width / 2), int(centre[1] * H - tmp.height / 2)
    calque.paste(tmp, (x, y), tmp)
    return Image.alpha_composite(img.convert("RGBA"), calque).convert("RGB")


def manuscrit(img, texte, pos, couleur=(25, 45, 150), taille=34, angle=-4):
    W, H = img.size
    tmp = Image.new("RGBA", (int(taille * 0.75 * len(texte)) + 60, taille * 2 + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    x = 10
    for ch in texte:  # léger tremblement lettre par lettre
        dy = random.randint(-3, 3)
        d.text((x, 10 + dy), ch, font=_font("DejaVuSans-Oblique.ttf", taille + random.randint(-2, 2)), fill=couleur + (235,))
        x += int(_font("DejaVuSans-Oblique.ttf", taille).getlength(ch)) + random.randint(-1, 1)
    tmp = tmp.rotate(angle, expand=True, resample=Image.BICUBIC)
    out = img.convert("RGBA")
    out.paste(tmp, (int(pos[0] * W), int(pos[1] * H)), tmp)
    return out.convert("RGB")


def entourer(img, box, couleur=(25, 45, 150)):
    """Ellipse tracée à la main autour d'une zone (fractions de page)."""
    W, H = img.size
    a = np.array(img)
    cx, cy = (box[0] + box[2]) / 2 * W, (box[1] + box[3]) / 2 * H
    rx, ry = (box[2] - box[0]) / 2 * W, (box[3] - box[1]) / 2 * H
    pts = []
    for t in np.linspace(0.1, 2 * np.pi + 0.5, 90):
        j = 1 + random.uniform(-0.04, 0.04)
        pts.append([cx + rx * j * np.cos(t), cy + ry * j * np.sin(t)])
    cv2.polylines(a, [np.array(pts, np.int32)], False, couleur, 4, cv2.LINE_AA)
    return Image.fromarray(a)


def souligner(img, y, x0, x1, couleur=(25, 45, 150)):
    W, H = img.size
    a = np.array(img)
    pts = [[int(x), int(y * H + random.uniform(-3, 3))] for x in np.linspace(x0 * W, x1 * W, 25)]
    cv2.polylines(a, [np.array(pts, np.int32)], False, couleur, 4, cv2.LINE_AA)
    return Image.fromarray(a)


def scanner(img, niveau, rot_deg=None, gris=True, trous=False, bord=True):
    """niveau : 'correct' | 'moyen' | 'degrade'."""
    cfg = {"correct": dict(rot=0.6, bruit=6, flou=0, jpeg=78, contraste=0.97, taches=0.0003),
           "moyen": dict(rot=1.4, bruit=11, flou=1, jpeg=62, contraste=0.9, taches=0.0012),
           "degrade": dict(rot=2.3, bruit=18, flou=1, jpeg=45, contraste=0.8, taches=0.003)}[niveau]
    a = np.array(img.convert("RGB")).astype(np.float32)
    if gris:
        g = a.mean(axis=2, keepdims=True)
        a = np.repeat(g, 3, axis=2)
    # papier légèrement jauni / non uniforme
    H, W = a.shape[:2]
    grad = np.linspace(0, 1, W)[None, :, None] * 10 + np.linspace(0, 1, H)[:, None, None] * 6
    a = a * cfg["contraste"] + (255 * (1 - cfg["contraste"])) - grad
    a += np.random.normal(0, cfg["bruit"], a.shape)
    a = np.clip(a, 0, 255).astype(np.uint8)
    # taches / poussières
    nb = int(H * W * cfg["taches"] / 50)
    for _ in range(nb):
        cv2.circle(a, (random.randrange(W), random.randrange(H)), random.randint(1, 3), (40, 40, 40), -1)
    if trous:
        for yy in (0.3, 0.7):
            cv2.circle(a, (int(0.035 * W), int(yy * H)), int(0.012 * W), (25, 25, 25), -1)
    if cfg["flou"]:
        a = cv2.GaussianBlur(a, (3, 3), 0.8)
    if bord:  # ombre du couvercle du scanner sur un bord
        e = int(0.012 * W)
        a[:, W - e:] = (a[:, W - e:] * 0.35).astype(np.uint8)
    ang = rot_deg if rot_deg is not None else random.uniform(-cfg["rot"], cfg["rot"])
    M = cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1.0)
    a = cv2.warpAffine(a, M, (W, H), borderValue=(70, 70, 70) if bord else (255, 255, 255))
    out = Image.fromarray(a)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=cfg["jpeg"])
    return buf.getvalue()


def pdf_vers_scan(src, dst, niveau, retouches=None, dpi=200, gris=True, trous=False, pivot90=()):
    """retouches : {index_page: [fonction(img) -> img, ...]} ; pivot90 : pages scannées de travers à 90°."""
    pages = convert_from_path(src, dpi=dpi)
    jpgs = []
    for i, img in enumerate(pages):
        for f in (retouches or {}).get(i, []):
            img = f(img)
        if i in pivot90:
            img = img.rotate(90, expand=True)
        jpgs.append(scanner(img, niveau, gris=gris, trous=trous))
    with open(dst, "wb") as fh:
        fh.write(img2pdf.convert(jpgs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((dpi, dpi))))
    return len(pages)
