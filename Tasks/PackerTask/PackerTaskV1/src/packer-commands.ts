export class PackerBaseCommandInitializer {
    public readonly name: string;
    public readonly workingDirectory: string;

    constructor(
        name: string,
        workingDirectory: string
    ) {
        this.name = name;
        this.workingDirectory = workingDirectory;
    }
}

export class PackerAuthorizationCommandInitializer extends PackerBaseCommandInitializer {
    readonly serviceProviderName: string;

    constructor(
        name: string,
        workingDirectory: string,
        serviceProviderName: string
    ) {
        super(name, workingDirectory);
        this.serviceProviderName = serviceProviderName;
    }
}
