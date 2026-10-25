package filerouter;

import java.io.*;
import java.util.Scanner;

public class UserHomeTest {
    public static void main(String[] args) throws FileNotFoundException {
        String basePathRC = System.getProperty("user.home") + "\\.fbprc";
        File f = new File(basePathRC);
        if (f.exists()) {
            Scanner scanner = new Scanner(f);
            String cont = scanner.nextLine();
            System.out.println(cont);
        }
    }

}