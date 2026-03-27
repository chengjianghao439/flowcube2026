# FlowCube：将 ZPL 字节以 RAW 作业提交到本机已安装的打印机（WinSpool）
# 打印机名由 Node 进程环境变量 FC_PRINTER_NAME 传入（UTF-16 环境块，避免命令行中文损坏）
param(
  [Parameter(Mandatory = $true)][string]$ZplPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ZplPath)) {
  Write-Error "ZPL file not found"
  exit 2
}
if ([string]::IsNullOrEmpty($env:FC_PRINTER_NAME)) {
  $PrinterName = ''
} else {
  $PrinterName = $env:FC_PRINTER_NAME.Trim()
}
if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  Write-Error "FC_PRINTER_NAME missing or empty"
  exit 3
}
$bytes = [System.IO.File]::ReadAllBytes($ZplPath)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FlowCubeRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  static extern bool StartDocPrinter(IntPtr hPrinter, int Level, [In] DOCINFO pDocInfo);
  [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
  static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static void Send(string printerName, byte[] bytes) {
    IntPtr h = IntPtr.Zero;
    if (!OpenPrinter(printerName, out h, IntPtr.Zero))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFO {
        pDocName = "FlowCube ZPL",
        pOutputFile = null,
        pDatatype = "RAW"
      };
      if (!StartDocPrinter(h, 1, di))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, p, bytes.Length);
          int written;
          if (!WritePrinter(h, p, bytes.Length, out written))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
          Marshal.FreeCoTaskMem(p);
        }
      } finally {
        EndPagePrinter(h);
        EndDocPrinter(h);
      }
    } finally {
      ClosePrinter(h);
    }
  }
}
'@

[FlowCubeRawPrint]::Send($PrinterName, $bytes)
