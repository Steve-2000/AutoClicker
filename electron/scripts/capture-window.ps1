param([long]$Handle)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public class WindowCapture {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);

    public struct RECT { public int Left, Top, Right, Bottom; }

    static bool IsBitmapBlank(Bitmap bmp) {
        int step = Math.Max(1, Math.Min(bmp.Width, bmp.Height) / 20);
        int blackCount = 0, totalSampled = 0;
        for (int y = step; y < bmp.Height - step; y += step) {
            for (int x = step; x < bmp.Width - step; x += step) {
                Color c = bmp.GetPixel(x, y);
                totalSampled++;
                if (c.R < 5 && c.G < 5 && c.B < 5) blackCount++;
            }
        }
        if (totalSampled == 0) return true;
        return (double)blackCount / totalSampled > 0.98;
    }

    static string BitmapToBase64Jpeg(Bitmap bmp) {
        using (MemoryStream ms = new MemoryStream()) {
            var encoderInfo = GetJpegEncoder();
            if (encoderInfo != null) {
                var ep = new EncoderParameters(1);
                ep.Param[0] = new EncoderParameter(Encoder.Quality, 75L);
                bmp.Save(ms, encoderInfo, ep);
            } else {
                bmp.Save(ms, ImageFormat.Jpeg);
            }
            return Convert.ToBase64String(ms.ToArray());
        }
    }

    public static void Capture(long handle) {
        IntPtr hWnd = new IntPtr(handle);

        // Restore if minimized
        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, 9); // SW_RESTORE
            Thread.Sleep(500);
        }

        RECT rect;
        GetWindowRect(hWnd, out rect);
        int width  = rect.Right  - rect.Left;
        int height = rect.Bottom - rect.Top;

        if (width <= 0 || height <= 0) {
            Console.WriteLine("{\"error\":\"invalid bounds\"}");
            return;
        }

        string b64 = "";
        bool captured = false;

        // Strategy 1: PrintWindow with PW_RENDERFULLCONTENT (best for GPU/Edge/Chrome)
        using (Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                PrintWindow(hWnd, hdc, 2);
                g.ReleaseHdc(hdc);
            }
            if (!IsBitmapBlank(bmp)) {
                b64 = BitmapToBase64Jpeg(bmp);
                captured = true;
            }
        }

        // Strategy 2: PrintWindow without flags
        if (!captured) {
            using (Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    IntPtr hdc = g.GetHdc();
                    PrintWindow(hWnd, hdc, 0);
                    g.ReleaseHdc(hdc);
                }
                if (!IsBitmapBlank(bmp)) {
                    b64 = BitmapToBase64Jpeg(bmp);
                    captured = true;
                }
            }
        }

        // Strategy 3: Bring to front and BitBlt screen capture
        if (!captured) {
            BringWindowToTop(hWnd);
            SetForegroundWindow(hWnd);
            Thread.Sleep(400);

            GetWindowRect(hWnd, out rect);
            width  = rect.Right  - rect.Left;
            height = rect.Bottom - rect.Top;

            using (Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
                }
                b64 = BitmapToBase64Jpeg(bmp);
                captured = true;
            }
        }

        if (!captured || string.IsNullOrEmpty(b64)) {
            Console.WriteLine("{\"error\":\"all capture strategies failed\"}");
            return;
        }

        Console.Write(
            "{\"left\":"  + rect.Left  +
            ",\"top\":"   + rect.Top   +
            ",\"width\":" + width      +
            ",\"height\":" + height    +
            ",\"screenshot\":\"" + b64 + "\"}"
        );
    }

    static ImageCodecInfo GetJpegEncoder() {
        foreach (var codec in ImageCodecInfo.GetImageDecoders())
            if (codec.FormatID == ImageFormat.Jpeg.Guid) return codec;
        return null;
    }
}
"@

[WindowCapture]::Capture($Handle)
