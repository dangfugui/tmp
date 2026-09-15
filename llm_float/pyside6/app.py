import os
import sys

from PySide6.QtCore import QObject, Qt, QUrl, Slot
from PySide6.QtGui import QColor, QCursor, QGuiApplication, QRegion
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMenu, QVBoxLayout, QWidget

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

ORB_SIZE = 68
BUTTON_WIN = 120  # extra room around the 68px circle for the widget
MARGIN = 22
CHAT_W = 400
CHAT_H = 620
CHAT_RADIUS = 16


def page(name):
    return os.path.join(WEB_DIR, name)


def work_area():
    return QGuiApplication.primaryScreen().availableGeometry()


class Backend(QObject):
    """Exposed to JavaScript as `api` via QWebChannel."""

    def __init__(self, window):
        super().__init__()
        self._window = window

    @Slot()
    def start_drag(self):
        """Native window move (smooth, cursor can leave the window)."""
        handle = self._window.windowHandle()
        if handle is not None:
            handle.startSystemMove()

    @Slot()
    def open_chat(self):
        self._window.app.open_chat()

    @Slot()
    def hide_chat(self):
        self._window.app.hide_chat()

    @Slot()
    def show_menu(self):
        self._window.app.show_menu()

    @Slot()
    def quit(self):
        QApplication.quit()


class WebWindow(QWidget):
    def __init__(
        self, app, title, url, width, height, shape="rect", size=None, radius=0
    ):
        super().__init__(
            None,
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool,
        )
        self.app = app
        self._shape = shape
        self._shape_size = size
        self._shape_radius = radius
        self.setWindowTitle(title)

        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_NoSystemBackground, True)
        self.resize(width, height)

        self.view = QWebEngineView(self)
        self.view.setAttribute(Qt.WA_TranslucentBackground, True)
        self.view.setContextMenuPolicy(Qt.NoContextMenu)
        self.view.page().setBackgroundColor(QColor(0, 0, 0, 0))

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.view)

        self.backend = Backend(self)
        self.channel = QWebChannel(self.view.page())
        self.channel.registerObject("api", self.backend)
        self.view.page().setWebChannel(self.channel)

        self.view.load(QUrl.fromLocalFile(url))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._apply_mask()

    def _apply_mask(self):
        if self._shape == "ellipse":
            d = self._shape_size or min(self.width(), self.height())
            x = (self.width() - d) // 2
            y = (self.height() - d) // 2
            self.setMask(QRegion(x, y, d, d, QRegion.Ellipse))
        elif self._shape == "rect" and self._shape_radius > 0:
            r = min(self._shape_radius, self.width() // 2, self.height() // 2)
            region = QRegion(0, 0, self.width(), self.height())
            for cx, cy in (
                (0, 0),
                (self.width() - r, 0),
                (0, self.height() - r),
                (self.width() - r, self.height() - r),
            ):
                region = region.subtracted(QRegion(cx, cy, r, r, QRegion.Ellipse))
            self.setMask(region)


class App:
    def __init__(self):
        self.orb = None
        self.chat = None

    def open_chat(self):
        if self.chat is None:
            geo = work_area()
            self.chat = WebWindow(
                self,
                "ai-chat",
                page("chat.html"),
                CHAT_W,
                CHAT_H,
                shape="rect",
                radius=CHAT_RADIUS,
            )
            self.chat.move(
                geo.x() + geo.width() - CHAT_W - MARGIN,
                geo.y() + geo.height() - CHAT_H - MARGIN,
            )
        self.chat.show()
        self.chat.raise_()
        self.chat.activateWindow()

    def hide_chat(self):
        if self.chat is not None:
            self.chat.hide()

    def show_menu(self):
        menu = QMenu()
        quit_action = menu.addAction("退出")
        if menu.exec(QCursor.pos()) is quit_action:
            QApplication.quit()


def main():
    QApplication.setAttribute(Qt.AA_ShareOpenGLContexts, True)
    app = QApplication(sys.argv)

    controller = App()
    geo = work_area()
    inset = (BUTTON_WIN - ORB_SIZE) // 2

    orb = WebWindow(
        controller,
        "float-button",
        page("button.html"),
        BUTTON_WIN,
        BUTTON_WIN,
        shape="ellipse",
        size=ORB_SIZE,
    )
    orb.move(
        geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset,
        geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset,
    )
    controller.orb = orb
    orb.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
