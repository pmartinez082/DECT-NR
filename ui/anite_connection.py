import math
import socket
import sys
from datetime import datetime
import io

# Reconfigure stdout to use UTF-8 encoding with error handling
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER_IP = "192.168.1.1"
SERVER_PORT = 3334
TIMEOUT = 10

EMULATION_BASE_PATH = 'D:\\User Emulations\\ChannelSounder\\'

# Map emulation types to filenames
EMULATION_FILES = {
    'TDL-A': 'DECT-TDL-A.smu',
    'TDL-B': 'DECT-TDL-B.smu',
    'TDL-C': 'DECT-TDL-C.smu',
    'AWGN': 'DECT-AWGN.smu'
}


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Encode message with error handling to avoid encoding issues on Windows console
    try:
        print(f"[ANITE][{ts}] {msg}", flush=True)
    except UnicodeEncodeError:
        # Fallback: replace problematic characters with ASCII equivalents
        safe_msg = msg.encode('ascii', errors='replace').decode('ascii')
        print(f"[ANITE][{ts}] {safe_msg}", flush=True)


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
                     interferer: int,
                     snr_db: float) -> None:
    """
    Configure interference generator for a given channel.
    """
    # get current datarate and noise bandwidth
    send(sock, "OUTPut:INTERFerence:DATARate:GET? "+str(interferer))
    datarate = float(recv_line(sock)) * 1000
    noiseband = 1.539 * 10**6
    ebN0 = snr_db - 10 * math.log10(datarate / noiseband)
    send(sock, f"OUTP:INTERFerence:EBN0:SET {interferer},{ebN0}")

   

def main(snr_db: float = None, emulation_type: str = 'AWGN') -> int:
    sock = None
    try:
        # Construct emulation path based on type
        emulation_file = EMULATION_FILES.get(emulation_type, EMULATION_FILES['AWGN'])
        emulation_path = EMULATION_BASE_PATH + emulation_file
        log(f"Using emulation file: {emulation_path}")
        
        sock = connect()

        # Open emulation
        send(sock, f"CALCulate:FILTer:FILE {emulation_path}")
        check_error(sock)

       

        # Run emulation
        send(sock, "DIAG:SIMU:GO")
        check_error(sock)

        log("Emulation is running")
        
        # Set SNR if provided
        if snr_db is not None:
            set_snr(sock, interferer=1, snr_db=snr_db)
            check_error(sock)
            log(f"SNR set to {snr_db} dB")

        # Keep running until interrupted
        log("Emulation will run until stopped externally")
        import time
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            log("Keyboard interrupt received")
       
        return 0

    except Exception as e:
        log(f"ERROR: {e}")
        return 1
    
    finally:
        # Always close the socket, even if an error occurred
        if sock:
            try:
                log("Closing socket connection")
                sock.close()
                log("Connection closed")
            except Exception as e:
                log(f"Error closing socket: {e}")


if __name__ == "__main__":
    snr = None
    emulation_type = 'AWGN'
    
    if len(sys.argv) > 1:
        try:
            snr = float(sys.argv[1])
            log(f"Starting emulation with SNR={snr} dB")
        except ValueError:
            log(f"Invalid SNR value: {sys.argv[1]}")
            sys.exit(1)
    
    if len(sys.argv) > 2:
        emulation_type = sys.argv[2]
        if emulation_type not in EMULATION_FILES:
            log(f"Invalid emulation type: {emulation_type}")
            sys.exit(1)
    
    sys.exit(main(snr_db=snr, emulation_type=emulation_type))