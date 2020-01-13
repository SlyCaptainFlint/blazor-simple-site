public class Photo
{
    public int Id { get; set; }

    public string Url_m { get; set; }

    public string Url_l { get; set; }

    public string ImageHiddenClass => ImageHidden ? "hidden" : "";

    public bool ImageHidden { get; set; } = true;

    public string ImageCollapsedClass => ImageCollapsed ? "collapsed" : "";
    public bool ImageCollapsed { get; set; } = false;
}