import socket
import sys
from datetime import datetime

SERVER_IP = "192.168.1.1"
SERVER_PORT = 3334
TIMEOUT = 10

EMULATION_PATH = r'"D:\User Emulations\ChannelSounder\DECT-AWGN.smu"'



def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ANITE][{ts}] {msg}", flush=True)


def connect() -> socket.socket:
    log(f"Connecting to {SERVER_IP}:{SERVER_PORT}")
    s = socket.create_connection((SERVER_IP, SERVER_PORT), timeout=TIMEOUT)
    log("Connection established")
    return s


def send(sock: socket.socket, cmd: str) -> None:
    log(f">>> {cmd}")
    sock.sendall((cmd + "\n").encode("ascii"))


def recv_line(sock: socket.socket) -> str:
    buf = bytearray()
    while True:
        b = sock.recv(1)
        if not b:
            break
        buf.extend(b)
        if b == b"\n":
            break
    return buf.decode("ascii").strip()


def check_error(sock: socket.socket) -> None:
    send(sock, "SYST:ERR?")
    err = recv_line(sock)
    log(f"<<< SYST:ERR? → {err}")
    if not err.startswith("0"):
        raise RuntimeError(err)


def main() -> int:
    try:
        sock = connect()

        # Open emulation
        send(sock, f"CALC:FILT:FILE {EMULATION_PATH}")
        check_error(sock)

        # Run emulation
        send(sock, "DIAG:SIMU:GO")
        check_error(sock)

        log("Emulation is running")

        sock.close()
        log("Connection closed")
        return 0

    except Exception as e:
        log(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
