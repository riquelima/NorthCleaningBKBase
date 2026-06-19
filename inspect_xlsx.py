import pandas as pd

def inspect_excel(file_path):
    print(f"Lendo o arquivo: {file_path}")
    excel_file = pd.ExcelFile(file_path)
    print("Planilhas disponíveis:", excel_file.sheet_names)
    
    for sheet_name in excel_file.sheet_names:
        df = pd.read_excel(file_path, sheet_name=sheet_name)
        print("\n" + "="*50)
        print(f"Planilha: {sheet_name}")
        print(f"Total de linhas: {len(df)}")
        print("Colunas:", df.columns.tolist())
        print("Amostra das 3 primeiras linhas:")
        print(df.head(3).to_string())
        print("="*50)

if __name__ == "__main__":
    inspect_excel("facebook.xlsx")
