import re

# Match lines like:
# PDC 729083.268 Seq:25 Tx:4 Temp:36
pattern = re.compile(r"PDC\s+(\d+\.\d+)")

EXPECTED_INTERVAL = 40.0
TOLERANCE = 0.001  # Adjust if needed for floating-point comparisons

def calculate_mismatches(log_file):
    previous_time = None
    previous_mismatch_time = None

    with open(log_file, "r") as f:
        for line in f:
            match = pattern.search(line)
            if not match:
                continue

            current_time = float(match.group(1))

            if previous_time is not None:
                delta = current_time - previous_time

                if abs(delta - EXPECTED_INTERVAL) > TOLERANCE:
                    print(f"Mismatch at {current_time:.3f}: interval = {delta:.3f}s")

                    if previous_mismatch_time is not None:
                        gap = current_time - previous_mismatch_time
                        print(f"    Time since previous mismatch: {gap:.3f}s")

                    previous_mismatch_time = current_time

            previous_time = current_time


if __name__ == "__main__":
    calculate_mismatches("logs/master_output.txt")