package filerouter;

import com.example.filerouter.FileRouterApplication;
import com.example.filerouter.common.FileProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(classes = {FileRouterApplication.class})
@EnableConfigurationProperties
public class MyTest {

    @Autowired
    FileProperties fileProperties;

    @Test
    public void test1() {
        System.out.println(fileProperties.getBasePath());
    }
}