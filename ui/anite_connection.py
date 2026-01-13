import math
import socket
import sys
from datetime import datetime
import io
import signal
import threading

# Reconfigure stdout to use UTF-8 encoding with error handling
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Global socket and control references
_socket = None
_running = True
_command_queue = []
_command_lock = threading.Lock()

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
    

def close_emulation(sock: socket.socket) -> None:
    """
    Properly close the ANITE emulation and check for errors.
    """
    try:
        log("Closing ANITE emulation...")
        send(sock, "DIAG:SIMU:CLOSE")
        check_error(sock)
        log("ANITE emulation closed successfully")
    except Exception as e:
        log(f"Error closing emulation: {e}")


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

   

def signal_handler(signum, frame):
    """Handle termination signals to properly close ANITE emulation."""
    global _running
    log(f"Signal {signum} received, closing emulation...")
    _running = False
    if _socket:
        try:
            close_emulation(_socket)
        except Exception as e:
            log(f"Error in signal handler: {e}")
    sys.exit(0)


def stdin_reader_thread():
    """Thread that continuously reads commands from stdin (works on Windows)."""
    global _command_queue, _running
    try:
        while _running:
            try:
                line = sys.stdin.readline().strip()
                if line:
                    with _command_lock:
                        _command_queue.append(line)
                else:
                    # EOF reached
                    break
            except Exception as e:
                log(f"Error reading stdin: {e}")
                break
    except Exception as e:
        log(f"Stdin reader thread error: {e}")


def main(snr_db: float = None, emulation_type: str = 'AWGN') -> int:
    global _socket, _running, _command_queue
    sock = None
    try:
        # Construct emulation path based on type
        emulation_file = EMULATION_FILES.get(emulation_type, EMULATION_FILES['AWGN'])
        emulation_path = EMULATION_BASE_PATH + emulation_file
        log(f"Using emulation file: {emulation_path}")
        
        sock = connect()
        _socket = sock  # Store globally for signal handler
        
        # Register signal handlers for clean shutdown
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

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

        # Start stdin reader thread (works on Windows)
        _running = True
        stdin_thread = threading.Thread(target=stdin_reader_thread, daemon=True)
        stdin_thread.start()
        
        log("Emulation running. Listening for SNR update commands...")
        import time
        
        try:
            while _running:
                # Check for pending commands
                with _command_lock:
                    if _command_queue:
                        command = _command_queue.pop(0)
                    else:
                        command = None
                
                if command:
                    log(f"Received command: {command}")
                    
                    # Parse SNR update command: snr_update:value:channel
                    if command.startswith('snr_update:'):
                        parts = command.split(':')
                        if len(parts) >= 3:
                            try:
                                new_snr = float(parts[1])
                                log(f"Updating SNR to {new_snr} dB")
                                set_snr(sock, interferer=1, snr_db=new_snr)
                                check_error(sock)
                                log(f"SNR updated to {new_snr} dB")
                            except (ValueError, RuntimeError) as e:
                                log(f"Error updating SNR: {e}")
                    
                    elif command == 'stop':
                        log("Stop command received")
                        _running = False
                        break
                
                time.sleep(0.1)  # Short sleep to avoid busy-waiting
                
        except KeyboardInterrupt:
            log("Keyboard interrupt received")
            _running = False
       
        return 0

    except Exception as e:
        log(f"ERROR: {e}")
        return 1
    finally:
        _running = False
        if sock:
            try:
                close_emulation(sock)
                sock.close()
            except Exception as e:
                log(f"Error closing connection: {e}")
        
        _socket = None


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