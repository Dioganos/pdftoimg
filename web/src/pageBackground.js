export function drawPageBackground(ctx, img, W, H) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  ctx.drawImage(img, 0, 0, iw, ih, 0, 0, W, H);
}
