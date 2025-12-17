import socket
import sys
import traceback
from datetime import datetime


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ANITE][{ts}] {msg}", flush=True)


def connect_socket(server: str, port: int) -> socket.socket:
    for res in socket.getaddrinfo(server, port, socket.AF_UNSPEC, socket.SOCK_STREAM):
        af, socktype, proto, canonname, sa = res
        try:
            s = socket.socket(af, socktype, proto)
            s.settimeout(5)
            s.connect(sa)
            return s
        except OSError:
            try:
                s.close()
            except Exception:
                pass
            continue

    raise ConnectionError(f"Unable to connect to {server}:{port}")


def send_command(sock: socket.socket, cmd: str) -> None:
    log(f"Sending command: {cmd}")
    sock.sendall((cmd + "\n").encode("ascii"))


def read_response(sock: socket.socket) -> str:
    response = bytearray()

    while True:
        chunk = sock.recv(1)
        if not chunk:
            break
        response.extend(chunk)
        if chunk == b"\n":
            break

    return response.decode("ascii").strip()


def main() -> int:
    server = "localhost"
    port = 3334

    log("Starting ANITE / Propsim connection test")

    try:
        sock = connect_socket(server, port)
        log(f"Connected to {server}:{port}")

        send_command(sock, "*IDN?")
        response = read_response(sock)

        log(f"Received response: {response}")

        sock.close()
        log("Connection closed successfully")

        return 0

    except Exception as e:
        log(f"ERROR: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
