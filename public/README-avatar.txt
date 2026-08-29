Put Arif's display picture in this folder as:

    arif.jpg

That's it — the app points at "/arif.jpg" (see ARIF_AVATAR at the top of
src/App.jsx). A square image works best; anything else gets center-cropped
to a circle. If you'd rather use a .png, save it as arif.png here and
change ARIF_AVATAR to "/arif.png".

Until the file exists, every avatar falls back to the 👨 emoji.
