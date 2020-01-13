using System.Threading.Tasks;
using Microsoft.JSInterop;

public class MainContainerSizeProvider
{
    private readonly IJSRuntime _js;

    public MainContainerSizeProvider(IJSRuntime js)
    {
        _js = js;
    }

    public async Task<Dimensions> GetDimensions()
    {
        return await _js.InvokeAsync<Dimensions>("getMainContainerDimensions");
    }
}

public class Dimensions
{
    public int Width { get; set; }
    public int Height { get; set; }
}