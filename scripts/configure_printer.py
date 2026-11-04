import sys

def configure_epson():
    try:
        import win32print, win32con
    except ImportError:
        print("[PrinterConfig] pywin32 not installed, skipping direct DEVMODE configuration.")
        return False

    printer_name = "EPSON L3250 Series"
    
    # Check if printer is installed
    printers = [p[2] for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)]
    target = None
    for p in printers:
        if printer_name.lower() in p.lower():
            target = p
            break
            
    if not target:
        print(f"[PrinterConfig] Target printer '{printer_name}' not found among: {printers}")
        return False
        
    print(f"[PrinterConfig] Configuring '{target}' for 102x152mm Glossy Borderless...")
    
    hPrinter = win32print.OpenPrinter(target, {"DesiredAccess": win32print.PRINTER_ALL_ACCESS})
    try:
        pInfo = win32print.GetPrinter(hPrinter, 2)
        dm = pInfo['pDevMode']
        
        # 161 is Epson L3250's hardware ID for "102 x 152 mm (4 x 6 in)"
        dm.PaperSize = 161
        dm.PaperLength = 1520 # 152.0 mm
        dm.PaperWidth = 1020  # 102.0 mm
        dm.FormName = "102 x 152 mm (4 x 6 in)"
        
        # MediaType 3 is Photo Paper (Glossy)
        dm.MediaType = 3
        dm.Orientation = 1    # Portrait
        dm.Color = 2          # Color (DMCOLOR_COLOR)
        
        # Merge with printer driver
        win32print.DocumentProperties(0, hPrinter, target, dm, dm, win32con.DM_IN_BUFFER | win32con.DM_OUT_BUFFER)
        
        # Persist to printer default
        pInfo['pDevMode'] = dm
        pInfo['pSecurityDescriptor'] = None
        win32print.SetPrinter(hPrinter, 2, pInfo, 0)
        print(f"[PrinterConfig] Successfully configured '{target}'! PaperSize={dm.PaperSize}, MediaType={dm.MediaType}")
        return True
    except Exception as e:
        print(f"[PrinterConfig] Error configuring printer: {e}")
        return False
    finally:
        win32print.ClosePrinter(hPrinter)

if __name__ == "__main__":
    success = configure_epson()
    sys.exit(0 if success else 1)
