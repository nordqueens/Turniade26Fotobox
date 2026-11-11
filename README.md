# Turniade 2026 · Fotobox

Die Galerie läuft als statische Website auf GitHub Pages. Fotos ansehen, nach Wochentag und Kategorien filtern und als einzelne Bilddateien herunterladen geht ohne Anmeldung. Bei einer Mehrfachauswahl startet die Galerie die Downloads nacheinander. Danach wird die heruntergeladene Auswahl zurückgesetzt. Unterstützt das Gerät das Teilen von Bilddateien, bietet das Teilen-Symbol einen Weg ins native Teilen-Menü.

Die vier Einträge in `config.js` sind Testfotos. Ihre Wochentage und Kategorien sind Beispieldaten.

## Fotoordner

- `Assets/Fotos/Originale/` enthält die Fotos zum Herunterladen.
- `Assets/Fotos/Vorschau/` enthält die kleineren Bilder für die Galerie.
- `Assets/Fotos/Import/` enthält die lokalen Ausgangsdateien. Git ignoriert diesen Ordner.
- `Assets/Design/` enthält das Logo und die Olympia-Grafiken.

## Lokal öffnen

Im Projektordner `python3 -m http.server 8765` ausführen und im Browser [http://localhost:8765](http://localhost:8765) öffnen.

## GitHub Pages einrichten

1. Die Projektdateien in das GitHub-Repository hochladen.
2. Im Repository unter **Settings → Pages → Build and deployment** die Quelle **Deploy from a branch** und **main / (root)** auswählen.
3. Die Galerie unter der in GitHub angezeigten Adresse öffnen. Für das vorhandene Repository ist die vorgesehene Adresse `https://nordqueens.github.io/Turniade26Fotobox/`.

Wer die Testfotos nur lokal nutzen möchte, ersetzt `samplePhotos` in `upload/sample-photos.mjs` durch ein leeres Array und lässt `Assets/Fotos/Originale` und `Assets/Fotos/Vorschau` beim Veröffentlichen weg. Die Galerie und die Fotodateien sind über ihre URLs öffentlich erreichbar.

## Fotos im Admin-Bereich hochladen

Die Fotobox läuft auf GitHub Pages. Neue Originale und Vorschauen landen unter `Assets/Fotos/`. Der Katalog `Assets/Fotos/katalog.json` enthält Wochentage und Kategorien. Ein Upload-Stapel wird zusammen als ein Commit veröffentlicht. GitHub Pages baut die Seite danach automatisch neu. Ein Upload unterstützt JPG, PNG und WebP bis 20 MB pro Foto.

1. Auf GitHub einen [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) mit kurzer Laufzeit erstellen. Als Eigentümer `nordqueens` und unter **Only select repositories** nur `Turniade26Fotobox` wählen. Unter **Repository permissions** **Contents** und **Issues** jeweils auf **Read and write** stellen.
2. Auf der veröffentlichten Fotobox **Admin** öffnen. Das bisherige Admin-Passwort und den GitHub-Schlüssel eingeben. Die Admin-Seite prüft den Passwort-Hash im Browser. GitHub prüft separat die Schreibberechtigung.
3. Fotos auswählen, Wochentag und Kategorien setzen und **Fotos veröffentlichen** drücken. Über **Alle Fotos** lassen sich Einträge bearbeiten, ersetzen oder löschen.

Der GitHub-Schlüssel bleibt bis zum Abmelden oder bis zu 30 Minuten im selben Browser-Tab gespeichert. Den Schlüssel nach dem Event auf GitHub widerrufen. Passwort-Hash und Fotos sind Bestandteil des öffentlichen Repositorys. Gelöschte oder ersetzte Dateien können im Git-Verlauf abrufbar bleiben.

## Fotos melden

Das Ausrufezeichen öffnet nach Wahl des Grundes eine vorausgefüllte GitHub-Meldung. Zum Absenden ist eine GitHub-Anmeldung erforderlich. Bei jüngeren Kindern kann eine erwachsene Person das übernehmen. GitHub Issues müssen im Repository aktiviert sein. Die Fotobox blendet Bilder aus, sobald sie die offene Meldung beim nächsten Abruf sieht. Unter **Admin → Gemeldet** kann das Team sie prüfen und das Foto wieder anzeigen oder aus dem aktuellen Stand löschen.

[GitHub-Pages-Veröffentlichung](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Schrift und Gestaltung

Die Überschriften nutzen die lokal installierte **Yovalina Dream**. Auf anderen Geräten greift **Bricolage Grotesque** als Ersatz. Der Fließtext nutzt **DM Sans**. Sobald eine für diese Website lizenzierte Webfont-Datei vorliegt, kann sie unter `Assets/Design` abgelegt und im ersten `@font-face` in `styles.css` als zusätzliche `url("Assets/Design/YovalinaDream-Regular.woff2") format("woff2")` ergänzt werden. Alle Komponenten sind mit eigenem CSS gestaltet.
