# Simple site built with Blazor
This is a basic working example of a personal website built primarily with Blazor. The site features state-based CSS transformations, video backgrounds, and a photo gallery. Everything is done with Blazor, with the exception of video playback and dynamic image resizing in the gallery, which required JS functions that interop with Blazor.

To run locally, you must first set up and execute the SASS build pipeline.

`npm install`

`npm run start`

This will run the build pipeline in watch mode, so if you make any changes to the SASS files and save them, the CSS will be updated automatically.

After this is done, you can compile and run the site provided you have .NET 5.0 SDK installed. Execute the following command:

`dotnet run`

Then navigate to `https://localhost:5001` to see the site.
