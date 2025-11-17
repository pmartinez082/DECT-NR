import csv

# Input file name
input_file = "20251007_measurements_HARQ.csv"

# Output file names
server = input_file.replace(".csv", "_server.csv")
client = input_file.replace(".csv", "_client.csv")


# Open and read the input file
with open(input_file, newline='', encoding='utf-8') as f_in:
    reader = list(csv.reader(f_in))

# Create lists for even and odd lines
even_lines = []
odd_lines = []

# Iterate through each line with its index
for i, line in enumerate(reader):
    if i % 2 == 0:   # Even line (starting from index 0)
        even_lines.append(line)
    else:            # Odd line
        odd_lines.append(line)

# Write even lines to one file
with open(server, 'w', newline='', encoding='utf-8') as f_even:
    writer = csv.writer(f_even)
    writer.writerows(even_lines)

# Write odd lines to another file
with open(client, 'w', newline='', encoding='utf-8') as f_odd:
    writer = csv.writer(f_odd)
    writer.writerows(odd_lines)

