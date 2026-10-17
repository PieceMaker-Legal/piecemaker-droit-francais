using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PieceMaker
{
    public static class InstallerWindow
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length < 1) return 1;
            string url = args[0];
            int width = args.Length > 1 ? int.Parse(args[1]) : 960;
            int height = args.Length > 2 ? int.Parse(args[2]) : 760;
            string title = args.Length > 3 && args[3].Length > 0 ? args[3] : "Installation de PieceMaker";
            string iconPath = args.Length > 4 ? args[4] : "";
            string userData = args.Length > 5 ? args[5] : "";

            SetCurrentProcessExplicitAppUserModelID("PieceMaker.Installer");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Form form = new Form();
            form.Text = title;
            form.Width = width;
            form.Height = height;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimumSize = new Size(800, 600);
            if (iconPath.Length > 0)
            {
                try { form.Icon = new Icon(iconPath); }
                catch { }
            }

            WebView2 web = new WebView2();
            web.Dock = DockStyle.Fill;
            form.Controls.Add(web);

            form.Shown += delegate
            {
                CoreWebView2Environment.CreateAsync(null, userData).ContinueWith(delegate(Task<CoreWebView2Environment> envTask)
                {
                    if (envTask.IsFaulted)
                    {
                        ShowFailure(form, title, envTask.Exception);
                        return;
                    }
                    form.BeginInvoke(new Action(delegate
                    {
                        web.EnsureCoreWebView2Async(envTask.Result).ContinueWith(delegate(Task ready)
                        {
                            if (ready.IsFaulted)
                            {
                                ShowFailure(form, title, ready.Exception);
                                return;
                            }
                            form.BeginInvoke(new Action(delegate
                            {
                                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                                web.Source = new Uri(url);
                            }));
                        });
                    }));
                });
            };

            Application.Run(form);
            return 0;
        }

        private static void ShowFailure(Form form, string title, Exception error)
        {
            form.BeginInvoke(new Action(delegate
            {
                MessageBox.Show(form, error.GetBaseException().Message, title);
                form.Close();
            }));
        }
    }
}
