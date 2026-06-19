import pandas as pd

df = pd.read_excel("facebook.xlsx")

print("Format of the dataframe:")
print(f"Rows: {df.shape[0]}, Cols: {df.shape[1]}")

# Vamos salvar as primeiras 100 linhas em formato de texto para podermos olhar as colunas preenchidas em cada linha
rows_info = []
for idx, row in df.head(100).iterrows():
    non_null = {col: val for col, val in row.items() if pd.notnull(val)}
    if non_null:
        rows_info.append((idx, non_null))

# Salva em um arquivo de texto para que possamos ler se for grande, ou imprime
with open("sample_structure.txt", "w", encoding="utf-8") as f:
    for idx, data in rows_info:
        f.write(f"--- Linha {idx} ---\n")
        for col, val in data.items():
            f.write(f"  {col}: {val}\n")
        f.write("\n")

print("Estrutura das primeiras 100 linhas salva em sample_structure.txt")
