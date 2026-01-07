import socket
import sys
from datetime import datetime

SERVER_IP = "192.168.1.1"
SERVER_PORT = 3334
TIMEOUT = 10

EMULATION_PATH = 'D:\\User Emulations\\ChannelSounder\\DECT-AWGN.smu'



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
def set_snr(sock: socket.socket,
                     channel: int,
                     interferer: int,
                     profile: str,
                     snr_db: float) -> None:
    """
    Configure interference generator for a given channel.
    """

    # Set interference profile
    send(sock, f"CALC:CHAN{channel}:INT{interferer}:PROF {profile}")
    check_error(sock)

    # Set SNR
    send(sock, f"CALC:CHAN{channel}:INT{interferer}:SNR {snr_db}")
    check_error(sock)


def main() -> int:
    try:
        sock = connect()

        # Open emulation
        send(sock, f"CALCulate:FILTer:FILE {EMULATION_PATH}")
        check_error(sock)

       

        # Run emulation
        send(sock, "DIAG:SIMU:GO")
        check_error(sock)

        log("Emulation is running")

        set_snr(sock, channel=1677, interferer=1, profile="AWGN", snr_db=10)
        check_error(sock)



        # Stop emulation
        send(sock, "DIAG:SIMU:STOP")
        #check_error(sock)

      

        # Close connection
       # sock.close()
        #log("Connection closed")
       
        return 0

    except Exception as e:
        log(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

'''
NOTES


OUTPut:INTERFerence:EBN0:SET <interference identification>,<Eb/N0>
SNR = Eb/N0 (dB) + 10log(datarate/noise bandwidth)
noise bandwidth = 1.539 MHz
datarate = 50 kbps
Eb/N0 = SNR - 10log(50e3/1.539e6)

'''